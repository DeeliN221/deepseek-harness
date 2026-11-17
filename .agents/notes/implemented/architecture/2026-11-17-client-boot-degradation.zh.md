# Agent Note: Client boot degradation

Status: implemented

[English](2026-11-17-client-boot-degradation.md) | 中文

## 问题

浏览器启动会审计完整的客户端 roster，并在任一 entry 未激活时拒绝启动。因此，一个已安装插件只要 bundle 导入失败、`apply` 抛错，或它提供的服务始终没有出现，就会只留下启动页而没有应用。

第三方插件让这种情况变成常态。Cordis 等待被注入的服务时没有超时，所以一个缺失的提供方会让所有消费者一直 pending：一个从未提供服务的客户端 `uiConversation` 让十个内置消费者停在 pending，页面根本无法挂载。而唯一能关掉插件的界面——设置 → 插件——正是挂载失败的那个应用的一部分，用户没有回到页面内的路径。

Host 启动早已区分「应用离开就跑不起来」的 entry 和「只是更希望有」的 entry（[required startup ids](../../../../packages/boot/app-boot/src/index.ts)）；浏览器这一侧没有这种区分。

## 决定

启动改为报告而不是拒绝，外壳在未激活的 entry 之上照常挂载。[client plugin loading model](2026-07-23-client-plugin-loading-model.zh.md) 负责模块到达、Cordis 生命周期与 HMR；本注记负责哪些失败会阻止挂载。

| 组成 | 归属 | 行为 |
| --- | --- | --- |
| `auditEntries` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | 为每个非 active entry 返回一条失败记录及其原因：导入错误、缺失服务或纤维状态 |
| `REQUIRED_CLIENT_ENTRY_IDS` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | `connection`、`ui-layout`、`ui-renderer` —— Host 连接、贡献 `root` 的布局，以及持有 React 根的渲染器 |
| `fatalFailures` | [`boot-client.ts`](../../../../packages/client/web/src/boot-client.ts) | 挑出仍然阻止挂载的失败 |
| `renderBootNotice` | [`boot-notice.ts`](../../../../packages/client/web/src/boot-notice.ts) | React 挂载点之外的页面本地可关闭提示，按名列出每个被跳过的行及其原因 |

`bootClient` 返回完整失败清单；`AppWebEntry.run` 只在必需 entry 失败时抛出，否则继续挂载再渲染提示。启动页继续报告进度，不再投影逐 entry 失败，因为这些失败已经不是致命的。

被跳过的行留在 Loader 树里并且保持静止：Cordis 不会激活导入失败或服务始终不到的纤维，而在无人提供服务时消费者会无限期 pending。由于 entry 被保留，会话中稍后通过动态图同步到达的提供方会激活它的消费者；提示每次页面加载只渲染一次，不跟随这些变化。

## 考虑过的替代方案

**保留严格启动，只在启动页加一条恢复链接。** 启动页没有 RPC：在不依赖框架的页面里拉取插件管理器 API 等于复制设置界面，而且这个页面依然无法渲染对话。

**把每一行都当作可选。** 那么缺少 `connection`、`ui-layout` 或 `ui-renderer` 时会挂载一个既连不上 Host 也画不出东西的外壳，表达的比启动页的点名失败更少。这个分级为这三者保留可诊断的失败，其余一律降级。

**拒绝发布宿主上服务没有提供方的启动图。** 服务提供是运行时事实：`apply` 可能较晚注册，插件也可能合法地在消费者之后激活。Host 无法知道，因此无法决定。

**在审计时给 pending entry 加超时。** Cordis 的 `PENDING` 是持久状态而不是慢；超时只能给启动路径增加定时策略，并给出同一份报告。

## 结果

外壳、能关闭插件的设置页，以及 agent 对话，在任何第三方客户端插件面前都能存活——这正是目的：坏插件只损失它自己的功能，不损失页面。

随之而来的是三项代价。必需集合是策略而不是探测：以后新增的外壳关键 entry 会降级而不是响亮失败，除非同时加进 `REQUIRED_CLIENT_ENTRY_IDS`。被跳过行的消费者在 Loader 里保持 `pending`，因此迟到的提供方会悄悄把它们打开，而提示仍然列着它们。以及，带着坏对话插件挂载的页面在提示被读到之前看起来是完好的，所以提示必须保持可见且不挡路，而不是自动消失。

回归测试是 `packages/client/web/tests/boot-client.client.spec.ts`（审计、必需项筛选、报告文本）、`boot.client.spec.ts`（可选失败照常挂载并显示提示；必需失败仍然失败）与 `boot-notice.client.spec.ts`（渲染与关闭）。

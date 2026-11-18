# Agent Note: 停止操作级联到该回合的任务与子智能体

Status: implemented

[English](2026-11-18-cascade-stop.md) | 中文

## 问题

composer 的停止按钮只向 Agent 请求中止，别的什么都不做。一个已经起了后台 shell、后台 job 或委派了子智能体的回合，在点击之后仍在产出输出，因为被中止的那个阶段只包含模型流：`jobs` 条目和子 Session 各自有独立生命周期。用户把这读作"停止按钮没用"，而单击即生效也让一次误点具有破坏性。

## 决定

`session.cancel` 接受 `cascade`。置位时，一次调用停掉该回合拥有的全部工作：

| 步骤 | 效果 |
| --- | --- |
| `agent.cancel({ kind: 'user' })` | 中止在途模型流与该阶段信号（工具本就在接收） |
| `jobs.list(sessionId)` 后 `jobs.kill(id, sessionId, 'turn cancelled')` | 杀掉该 Session 拥有的每个后台 shell 与 job |
| `subagents.listDescendants(sessionId)` 后 `interrupt(child, { kind: 'user', parentSessionId })` | 中断每个子 Session，各自在其直接父的授权下 |

Client 始终请求级联，因此不存在第二个需要推理的开关。后台工具（`bash`、`run_code`）已经把 `exec.signal` 转发进自己的进程或 worker，所以阶段中止能到达它们，不需要改工具层。

composer 现在第一次点击进入 armed，四秒内第二次点击才取消，armed 期间按钮显示警示色。键盘停止手势保持不变。

## 考虑过的替代方案

**第一次点击就杀掉全部。** 一次误点会毁掉一个运行中的回合及其任务。两步操作多花一次点击，换来让破坏性动作保持刻意。

**从浏览器里杀 job 和子智能体。** Client 够不到另一个进程的任务注册表，也够不到子 Session 的 Agent；两者都在 Host 服务后面。Client 侧清扫还会与 Host 自己的任务状态失同步。

**以根 Session 的授权中断所有后代。** `interrupt` 依据目标直接父级授权，从根去中断孙级会被拒绝；后代清单本身就带着各自的直接父。

## 结果

一次点击现在能停掉一个回合在各处产出的输出。代价是耦合：`session-controller` 为注册表类型新增了 `@deepseek-ai/dsh-jobs` 的 peer 与 dev 依赖，取消也依赖两个可选服务——没有 `jobs` 或 `subagents` 的 Host 仍会取消它的 Agent，并且不记录任何东西。

子智能体中断在回执之后异步完成，因为后代清单是一次持久的 Session 读取；因此回执的含义仍是"已请求取消"，与之前一致，而已经结束的子会话只会记为一条警告，不会被当作取消失败。

验证：`commands-queue-attachment.host.spec.ts` 断言级联时的 job 与后代调用，以及裸取消时没有这些调用；`input-bar.client.spec.tsx` 断言第一次点击只 armed、确认文案、第二次点击取消。

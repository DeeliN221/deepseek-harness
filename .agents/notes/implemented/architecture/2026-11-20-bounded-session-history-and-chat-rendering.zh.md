# Agent Note: 有界 Session 历史与 Chat 渲染

Status: implemented

[English](2026-11-20-bounded-session-history-and-chat-rendering.md) | 中文

## 问题

当一个 Turn 包含大量持久事件时，仅限制消息数和 Turn 数仍无法限制单页大小。即使大部分已加载的 Chat 顺序位于当前可见 transcript 上方，浏览器仍会渲染整段内容。

## 决策

Client 历史页和 follow 请求携带 `maxEvents`，默认值为 2,000；Host 接受的显式上限为 5,000。消息、Turn 和 source 对齐边界都限制在所选事件页范围内，向前回溯扫描也会在该边界停止；因此有界页面可能从某个 Turn 或 source 组中间开始。

`ChatView` 保留完整已加载顺序、Node store、位置索引和轮次导航索引，同时最多渲染 240 个 Node key。初始渲染从尾部开始；向更早内容翻页时，先分片展示已加载 key，再请求 Host 的下一页。读者离开尾部时，prepend 通过当前 Session 的稳定 key 范围保留可见位置。已加载导航锚点仅在匹配 `turnOutline` 轮次后携带持久 `turn/start` 序列；`ChatView` 会校验该序列，再围绕稳定锚点 key 重置本地窗口。没有 outline 序列时，导航回退到已加载 key。未加载导航标记会先尝试本地展开；之后 `ChatNavigation` 只调用 `Session.loadThrough(seq)`，页面提交后再依据更新的导航轨道解析目标并定位。Session 切换会重置导航 owner，防止旧页面完成后移动新 Chat。实时追加沿用现有滚动归属。分组快照只渲染可见 key 集合中的成员，并保留可见 Turn 所需的过程控制项。

调用行为和限制见 [Session Controller README](../../../../packages/api/session-controller/README.zh.md) 与 [Chat README](../../../../packages/client/ui-chat/README.zh.md)。

## 曾考虑的替代方案

**只保留消息数和 Turn 数限制。** 长 Turn 可能包含大量非消息持久事件，因此仅靠这两项无法限制单页事件数。

**渲染尾部后丢弃更早的 Chat Node。** 这样会失去本地展示旧切片、已加载轮次导航和稳定 prepend 所需的数据。保留完整 store、只限制渲染的 Node key，可继续支持这些操作。

**把 `ChatNode.anchorSeq` 用作 Session 范围游标。** `anchorSeq` 是可排序的渲染位置，可能包含合成的小数偏移；持久轮次起始序列来自 `turnOutline`，已加载导航项只有在轮次匹配后才携带它。

## 后果

Host 事件上限可能截断 Turn 或 source 组。Client 必须将页面边界视为不完整，并通过 sequence anchor 继续读取，不能假设每页都包含完整 Turn。

渲染上限只计算顶层 Chat Node key，不限制事件 payload 字节、展开后的 Node 子项、解码或投影工作量、保留的实时事件，或完整冷 Session 所读取的字节。

## 验证

聚焦回归覆盖长 Turn 与 source 对齐、事件上限校验、有界尾窗、本地旧切片优先于 Host 翻页、prepend 后语义锚点、按序列校验的已加载隐藏轮次、本地已加载但导航标记仍未加载的目标、Host 分页后的本地展开、目标锚点缺失时重试、同一视图切换 Session 时取消旧跳转、实时追加，以及空或短顺序。授权归档对照分别记录 Host 页和渲染窗口数量，不测量浏览器绘制时间或网络传输量。

---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-23-session-async-dispatch

[English](2026-11-23-session-async-dispatch.md) | 中文

## 概述

增加会话级异步派发选择与入场策略事件，并在用户 RPC 消息来源中增加可选的提交偏好快照。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-session-async-dispatch
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "eacc5eb6ee06f75de2183e23a5612f7034aa0b0dc311eb2a7a386ee662cbf1f1"
    decision: same-version
  - root: "event:conversation/async-dispatch-admitted"
    previous: null
    after: "c92225efedd1de6447efd68011cad8fd8fd80b3b8249ba3076350d0eabd7e25d"
    decision: same-version
  - root: "event:conversation/async-dispatch-selected"
    previous: null
    after: "9127e66037311d114571e3471356ed7e886e767ae0db501699ea511e1ea6451c"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "ab4724782cbbbbfc210090686f59e933f68261afcfe267bae13e157d13b19c55"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "61aaec914cd84fccd32374c86fe00ca348e62a64d530979a2bd49a2553770949"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "7c01e45cd501a03e62dba38970fc882c6a1fad1f13e4e9dd8f71802cf35a1a93"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有用户来源保持有效，字段缺失按关闭处理。两个新增纯日志事件使用独立判别值，旧读取器遇到不认识的事件会安全拒绝而不会误解释。已接受基线记录和会话头版本保持不变。选择与当前策略独立，回放不会把后来的开关选择应用于先前入场的任务。

<a id="verification"></a>
## 验证

4个异步派发Host测试通过，覆盖默认、会话隔离、仅保存选择的命令、完整回放与检查点后缀等价、入场顺序及卸载。真实agent-loop测试确认首个请求策略、运行策略冻结和后续历史缺字段消息默认关闭。230项定向行为与发送测试通过。

<a id="dev-note"></a>
## 开发备注

无。

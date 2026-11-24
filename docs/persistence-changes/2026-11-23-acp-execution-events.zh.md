---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-23-acp-execution-events

[English](2026-11-23-acp-execution-events.md) | 中文

## 概述

新增持久化 ACP 执行绑定和外部模型确认，并为 model/selection 增加可选执行元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-acp-execution-events
baseline: false
changes:
  - root: "event:execution/bound"
    previous: null
    after: "e51479a2aa6b971263e996597c7b86d301dbe8e00ffdd9755b68859547b2a8f5"
    decision: same-version
  - root: "event:execution/model-confirmed"
    previous: null
    after: "f88dcc2b4e894a4cdf95bff17347041f21324261dfd3bb57ac020e1fd912a985"
    decision: same-version
  - root: "event:model/selection"
    previous: "2026-09-11-initial"
    after: "1368cc7b16aa37d335ec4b6d01f840fdc292a727cddc72fa1fa09a7ef69a9bd6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新 reader 将没有 execution/bound 的 Session 解释为原生或旧会话；不含 execution 或 displayName 的历史 model/selection 仍然有效且保持原义。定向 JSONL 恢复测试覆盖旧 Session 路径，并确认 ACP 的 execution/model-confirmed 投影可以恢复。不认识 execution/bound 或 execution/model-confirmed 的旧 reader 没有兼容保证：执行归属会影响路由，因此不能安全省略这些必需事件。Session 格式 V4 保持不变。创建 ACP 记录前升级所有访问共享存储的 reader；不能从 header 版本未变推断支持降级。

<a id="verification"></a>
## 验证

Mac darwin-arm64：pnpm run build:native-system 成功；pnpm exec vitest run packages/core/agent-loop/tests/execution-driver.spec.ts：JSONL 关闭/恢复、旧未绑定 Session 保持原生、ACP 确认模型投影恢复、排队 prompt 不重放等 6 项全部通过。pnpm exec vitest run packages/api/session-controller/tests/remote-access.host.spec.ts packages/api/session-controller/tests/commands-queue-attachment.host.spec.ts：29 项通过（14 + 15）。

<a id="dev-note"></a>
## 开发备注

无。

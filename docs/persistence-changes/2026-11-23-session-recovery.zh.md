---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-23-session-recovery

[English](2026-11-23-session-recovery.md) | 中文

## 概述

新增自动恢复撤销事件与已有队列唤醒的持久回执。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-session-recovery
baseline: false
changes:
  - root: "event:recovery/queued"
    previous: null
    after: "79ed2ac05482635d6cad3c303d29a51f8356a539db1f34c2976a517bfafe680e"
    decision: same-version
  - root: "event:recovery/revoked"
    previous: null
    after: "1c7d975d72255b2126f44334540a3a95a748df0c1a013362ff0178f8fcb1d2ff"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志保持有效。新的不可忽略 recovery/revoked 和 recovery/queued 判别标签使旧读取器拒绝相关日志，避免绕过人工停止或重放队列唤醒。新读取器保留原消息来源、权限与已完成工具结果；此拒绝式读取行为不需要提高 Session 格式版本。

<a id="verification"></a>
## 验证

在 macOS 执行恢复与手动续跑 Host 定向测试，以及 POSIX 巡检锁、持久化、有限退避和队列观测测试。隔离进程被杀及 transport/队列真实验收结果随 PR 记录。

<a id="dev-note"></a>
## 开发备注

无。

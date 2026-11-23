---
kind: upgrade-guide
description: "ACP Session 新增必需的执行归属和已确认模型事件；既有未绑定 Session 仍按原生会话处理。"
---

# ACP Session 记录执行归属

[English](guide.md) | 中文

## 变更

ACP Session 会在 Agent 发布前持久化 `execution/bound`，并且只在外部引擎确认模型后追加 `execution/model-confirmed`。既有 `model/selection` 载荷也新增可选字段 `execution` 和 `displayName`。Session 格式 V4 保持不变。

没有 `execution/bound` 的 V4 Session 保留原有原生或旧会话含义。历史 `model/selection` 载荷不需要带这两个可选字段。新 reader 恢复这类历史时不会将其转换成 ACP；`packages/core/agent-loop/tests/execution-driver.spec.ts` 中的 JSONL 恢复测试覆盖该路径。同一测试还确认 ACP 模型确认事件在 JSONL 关闭并恢复后仍保留。

两个新事件是正确选择执行引擎和模型投影所必需的。不能保证不认识这些事件的 reader 能打开包含它们的 Session。[持久化确认记录](../../../persistence-changes/2026-11-23-acp-execution-events.zh.md)说明类型变化和兼容边界。

## 迁移

1. 启用 ACP 前，找出所有可能读写同一 Session 存储的 DSH 进程，并将它们一并升级到认识这些事件的构建。使用实际存储中的代表性旧 Session 验证候选版本能打开它们；没有执行绑定的会话必须继续由原生执行器处理。
2. 写入第一条 ACP Session 前，备份实际 Session 存储，记录源/目标构建标识及存储路径，并在隔离位置恢复副本来验证备份。应用二进制备份与 Session 数据备份分别保存。
3. 将二进制回退与 Session 数据兼容性作为两个独立决定。ACP 记录写入后，不要假定旧 reader 能打开该存储。运行旧二进制前，先用写入 ACP 后的存储隔离副本测试该准确版本。兼容性检查通过前不承诺向下兼容。
4. 回退期间保持原始存储不变。不要移除 ACP 事件、编辑 JSONL 文件、删除已提交的代际或改写已提交代际来让旧 reader 接受它们。如果没有旧 reader 通过兼容检查，应保留数据，并在评审恢复方案期间继续使用认识这些事件的 reader。

---
kind: upgrade-guide
description: "ACP Sessions add required execution ownership and confirmed-model events; existing unbound Sessions remain native."
---

# ACP Sessions record execution ownership

English | [中文](guide.zh.md)

## Change

ACP Sessions persist `execution/bound` before the Agent is published and append `execution/model-confirmed` only after the external engine confirms its model. The existing `model/selection` payload also gains optional `execution` and `displayName` fields. Session format V4 remains unchanged.

A V4 Session without `execution/bound` retains its native or legacy meaning. Its historical `model/selection` payload does not need either optional field. A new reader restores that history without converting it to ACP; this path is covered by the JSONL resume test in `packages/core/agent-loop/tests/execution-driver.spec.ts`. The same test confirms that an ACP model confirmation survives JSONL close and resume.

The two new event types are required for correct execution routing and model projection. A reader that does not recognize them is not guaranteed to open a Session that contains them. The [persistence acknowledgement](../../../persistence-changes/2026-11-23-acp-execution-events.md) records the type changes and compatibility boundary.

## Migration

1. Before enabling ACP, identify every DSH process that can read or write the same Session store and upgrade them together to a build that recognizes these events. Validate that the candidate opens representative pre-ACP Sessions from the actual store; sessions with no execution binding must continue as native.
2. Before the first ACP Session is written, back up the actual Session store, record the source and target build identifiers and storage path, and verify the backup by restoring a copy in an isolated location. Keep the application binary backup separate from the Session data backup.
3. Treat binary rollback and Session data compatibility as separate decisions. Once ACP records exist, do not assume an earlier reader can open that store. Before running an earlier binary, test that exact build against an isolated copy of the post-ACP store. No downgrade compatibility is claimed until that check passes.
4. Keep the original store intact during rollback. Do not remove ACP events, edit JSONL files, delete committed generations, or rewrite a committed generation to make an earlier reader accept it. If no earlier reader passes the compatibility check, preserve the data and use a reader that recognizes the events while a recovery plan is reviewed.

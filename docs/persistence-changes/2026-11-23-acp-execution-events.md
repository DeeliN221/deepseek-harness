---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-acp-execution-events

English | [中文](2026-11-23-acp-execution-events.zh.md)

## Summary

Adds durable ACP execution binding and external model confirmation, and adds optional execution metadata to model/selection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

New readers interpret a Session without execution/bound as native or legacy; historical model/selection records without execution or displayName remain valid and keep their meaning. The focused JSONL resume test exercises that old-session path and confirms execution/model-confirmed projection restoration for ACP. Older readers that do not know execution/bound or execution/model-confirmed have no compatibility guarantee: these required events cannot be safely omitted because execution ownership affects routing. Session format V4 stays unchanged. Upgrade every reader of the shared store before creating ACP records; do not infer downgrade support from the unchanged header version.

<a id="verification"></a>
## Verification

Mac darwin-arm64: pnpm run build:native-system succeeded; pnpm exec vitest run packages/core/agent-loop/tests/execution-driver.spec.ts: 6 tests passed after JSONL close/resume, old unbound Session native restoration, confirmed ACP model projection restoration, and queued-prompt non-replay. pnpm exec vitest run packages/api/session-controller/tests/remote-access.host.spec.ts packages/api/session-controller/tests/commands-queue-attachment.host.spec.ts: 29 tests passed (14 + 15).

<a id="dev-note"></a>
## Dev Note

None.

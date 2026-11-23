---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-session-recovery

English | [中文](2026-11-23-session-recovery.zh.md)

## Summary

Adds durable automatic-recovery revocation and existing-inbox wake receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs remain valid. New non-ignorable recovery/revoked and recovery/queued discriminators make older readers refuse affected logs rather than bypass a human stop or replay a queued wake. New readers retain original message sources, permissions and completed tool results; no Session format bump is needed for this fail-closed reader behavior.

<a id="verification"></a>
## Verification

Focused recovery and continuation Host tests and POSIX scanner lock, persistence, bounded-backoff and queue-observation tests run on macOS. Real isolated process-kill and transport/queue acceptance results are recorded with the PR.

<a id="dev-note"></a>
## Dev Note

None.

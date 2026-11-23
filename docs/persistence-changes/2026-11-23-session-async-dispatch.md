---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-session-async-dispatch

English | [中文](2026-11-23-session-async-dispatch.zh.md)

## Summary

Adds a session-scoped async-dispatch selection and admitted-policy events, plus an optional captured preference on user-RPC message sources.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

All previous user sources remain valid and absence means off. The two new log-only events have unique discriminators; old readers that do not recognize them reject safely rather than reinterpret them. Existing accepted baseline records and Session header versions are unchanged. Selection and active policy are independent, so replay never applies a later switch selection to earlier admitted work.

<a id="verification"></a>
## Verification

The 4 async-dispatch Host tests pass for defaults, isolated sessions, command-only selection, replay/checkpoint equivalence, admission ordering and disposal. A real agent-loop test confirms first-request policy, frozen running policy and a later legacy input defaulting off. 230 targeted behavior and sender tests passed.

<a id="dev-note"></a>
## Dev Note

None.

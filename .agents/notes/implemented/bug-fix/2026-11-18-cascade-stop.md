# Agent Note: Cascade a stopped turn into its jobs and subagents

Status: implemented

English | [中文](2026-11-18-cascade-stop.zh.md)

## Problem

The composer's Stop control asked the Agent to abort and nothing else. A turn that had started a background shell, a background job, or a delegated subagent kept producing output after the click, because only the model stream belonged to the aborted phase: `jobs` entries and child Sessions run on their own lifecycles. Users read that as "the stop button does not work", and the single click also made a misplaced click destructive.

## Decision

`session.cancel` accepts `cascade`. When set, one call stops everything the turn owns:

| Step | Effect |
| --- | --- |
| `agent.cancel({ kind: 'user' })` | aborts the in-flight model stream and the phase signal tools already receive |
| `jobs.list(sessionId)` then `jobs.kill(id, sessionId, 'turn cancelled')` | kills every background shell and job the Session owns |
| `subagents.listDescendants(sessionId)` then `interrupt(child, { kind: 'user', parentSessionId })` | interrupts every child Session, each under its own direct parent's authority |

The Client always requests the cascade, so there is no second switch to reason about. Background tools (`bash`, `run_code`) already forward `exec.signal` into their process or worker, so the phase abort reaches them without a tool-level change.

The composer now arms on the first click and cancels on the second within four seconds, showing the warning colour while armed. The keyboard stop gesture is unchanged.

## Alternatives considered

**Kill everything on the first click.** One misclick would destroy a running turn and its jobs. The two-step control costs one click and keeps the destructive action deliberate.

**Kill jobs and subagents from the browser.** The Client cannot reach another process's job registry or a child Session's Agent; both live behind Host services. A Client-side sweep would also desynchronize from the Host's own job state.

**Interrupt descendants under the root Session's authority.** `interrupt` authorizes against the target's direct parent, so a grandchild addressed from the root would be refused; the descendant list already names each immediate parent.

## Consequences

One click now stops a turn's output everywhere it is produced. The cost is coupling: `session-controller` gained a `@deepseek-ai/dsh-jobs` peer and dev dependency for the registry types, and cancellation now depends on two optional services — a Host without `jobs` or `subagents` still cancels its Agent and logs nothing.

Subagent interruption resolves asynchronously after the acknowledgement, because the descendant list is a durable Session read; the receipt therefore means "cancellation requested", as it did before, and a child that already finished is a logged warning rather than a failed cancellation.

Verification: `commands-queue-attachment.host.spec.ts` asserts the job and descendant calls for a cascade and their absence for a bare cancel; `input-bar.client.spec.tsx` asserts the armed first click, the confirm label, and the second-click cancellation.

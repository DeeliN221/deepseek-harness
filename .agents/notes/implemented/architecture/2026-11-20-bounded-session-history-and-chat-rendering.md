# Agent Note: Bounded Session history and Chat rendering

Status: implemented

English | [中文](2026-11-20-bounded-session-history-and-chat-rendering.zh.md)

## Problem

Message and Turn minima do not bound a page when one Turn contains many durable events. The browser also renders a large loaded Chat order even when most of it is above the visible transcript.

## Decision

Client history and follow requests carry `maxEvents`, defaulting to 2,000; the Host accepts explicit limits up to 5,000. Message, Turn, and source-alignment cuts stay within the selected event floor, and the backward page scan stops there too, so a bounded page can begin inside a Turn or source group.

`ChatView` keeps the complete loaded order, node store, locations, and turn navigation index while rendering at most 240 node keys. It starts at the tail, reveals earlier loaded keys in slices before requesting another Host page, and keeps a session-scoped keyed range stable across prepends while the reader is away from the tail. A loaded rail anchor carries the durable `turn/start` sequence only when it matches a `turnOutline` entry; `ChatView` checks that sequence before recentering around the stable anchor key. If the outline sequence is unavailable, navigation falls back to the loaded key. An unloaded rail mark first tries this local reveal, then `ChatNavigation` calls only `Session.loadThrough(seq)`; after the page commits it resolves the target against the updated rail before landing. A Session switch resets the navigation owner so an older page completion cannot move the new Chat. Live appends follow existing scroll ownership. Grouped snapshots render only members in the visible key set while retaining process controls for visible Turns.

See the [Session Controller README](../../../../packages/api/session-controller/README.md) and [Chat README](../../../../packages/client/ui-chat/README.md) for caller behavior and limits.

## Alternatives considered

**Keep only message and Turn thresholds.** A long Turn can contain many durable non-message events, so those thresholds alone do not bound page events.

**Discard older Chat nodes after rendering the tail.** This would remove the data needed for local older-slice reveal, loaded-turn navigation, and stable prepends. Keeping the full store preserves those operations while limiting rendered node keys.

**Use `ChatNode.anchorSeq` as the Session range cursor.** `anchorSeq` is a sortable render position and can include synthetic fractional offsets; the durable turn-start sequence comes from `turnOutline`, so a loaded rail item carries it only after a turn match.

## Consequences

The Host event limit can split a Turn or source group. Clients must treat page boundaries as partial and continue from sequence anchors rather than assume the page contains a complete Turn.

The render limit counts top-level Chat node keys. It does not bound event payload bytes, expanded node descendants, decode or projection work, retained live events, or the bytes read for a complete cold Session.

## Verification

Focused regressions cover long-Turn and source alignment, event-limit validation, the bounded tail, local older-slice reveal before Host paging, semantic anchors after prepends, sequence-checked loaded-hidden reveals, an already-loaded target behind an unloaded rail mark, post-page reveal, missing-anchor retry, same-view Session-switch cancellation, live appends, and empty or short orders. The authorized archive comparison records page and render-window counts separately; it does not measure browser paint or network transfer.

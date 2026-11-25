/** One-shot cold session read through the handle-based persistence seam. */

import { interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset, SessionSeedEventState } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandleReadResult } from '@deepseek-ai/dsh-session-persistence'

/** A stored session log balanced for read-only viewing. */
export interface ColdSessionLog {
  /** Aliasing state of the persisted events; synthetic closers are locally owned. */
  readonly eventState: SessionSeedEventState
  /** The stored header, fixed when the read handle opened. */
  readonly header: SessionHeader
  /** Exact fork-inherited event count paired with {@link header}. */
  readonly inheritedEventCount: SessionLogOffset
  /** Stored events plus deterministic in-memory closers for an interrupted final turn; nothing is written back. */
  readonly events: SessionEvent[]
}

/**
 * Read one complete stored session log without taking ownership or mutating
 * storage: open a read handle, read the validated contiguous log, close the
 * handle, and append `interruptedTurnClosers` so a log whose writer crashed
 * mid-turn folds as a balanced transcript. Backend failures propagate
 * unmapped — each caller owns its error taxonomy.
 * @param persistence - the mounted persistence service.
 * @param sessionId - the stored session to read.
 * @param signal - optional cancellation for the open and read work.
 * @returns an adoptable seed in a caller-owned outer array, ready for in-place Session restoration.
 */
export async function readColdSessionLog(
  persistence: SessionPersistence,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<ColdSessionLog> {
  const options = signal === undefined ? undefined : { signal }
  const handle = await persistence.open(sessionId, 'read', options)
  let read: SessionHandleReadResult
  try {
    read = await handle.read(0, undefined, options)
  } catch (error: unknown) {
    try {
      await handle.close()
    } catch {
      // The read failure is the actionable cause; a close failure on the same broken handle adds nothing.
    }
    throw error
  }
  await handle.close()
  const { events } = read
  return {
    eventState: read.eventState,
    header: handle.header,
    inheritedEventCount: handle.inheritedEventCount,
    events: [...events, ...interruptedTurnClosers(events)],
  }
}

/** One bounded cold tail read of a stored session log. */
export interface ColdSessionTail {
  /** Aliasing state of the persisted events this read decoded. */
  readonly eventState: SessionSeedEventState
  /** Immutable Session identity metadata carried by the artifact. */
  readonly header: SessionHeader
  /** Exact fork-inherited event count paired with {@link header}. */
  readonly inheritedEventCount: SessionLogOffset
  /** The newest committed records, in seq order, ending at the last record. */
  readonly events: SessionEvent[]
  /** Every committed record in the stored log, including the skipped prefix. */
  readonly totalEvents: number
}

/**
 * Read only the newest records of one stored session log without taking
 * ownership, mutating storage, or materializing the prefix they follow.
 *
 * A caller that needs nothing older than a bounded page (an opening window, a
 * paged backward read at the log end) does not have to pay for the whole log.
 * The returned records end at the same last record {@link readColdSessionLog}
 * would return and carry their absolute seqs, so a page cut from this window is
 * identical to the same page cut from a full read; `totalEvents` keeps absolute
 * addressing intact.
 * @param persistence - the mounted persistence service.
 * @param sessionId - the stored session to read.
 * @param maxEvents - requested tail size in records.
 * @param signal - optional cancellation for the open and read work.
 * @returns the tail read, or `undefined` when the provider cannot read a tail cheaply.
 */
export async function readColdSessionTail(
  persistence: SessionPersistence,
  sessionId: SessionId,
  maxEvents: number,
  signal?: AbortSignal,
): Promise<ColdSessionTail | undefined> {
  const options = signal === undefined ? undefined : { signal }
  const handle = await persistence.open(sessionId, 'read', options)
  try {
    if (typeof handle.readTail !== 'function') return undefined
    const read = await handle.readTail(maxEvents, options)
    return {
      eventState: read.eventState,
      header: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      events: read.events as SessionEvent[],
      totalEvents: read.totalEvents,
    }
  } finally {
    await handle.close().catch(() => {
      // The read result is the actionable outcome; a read-handle close failure adds nothing.
    })
  }
}

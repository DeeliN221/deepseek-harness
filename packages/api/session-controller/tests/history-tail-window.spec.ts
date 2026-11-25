import { describe, expect, it } from 'vitest'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_MAX_MESSAGES, paginate } from '../src/history.ts'

/** One append-surface message event at its absolute seq. */
function message(seq: number, role: 'user' | 'assistant'): SessionEvent {
  const row = {
    type: role === 'user' ? 'user/message' : 'assistant/message',
    seq: SessionSeq(seq),
    time: seq,
    data: { turn: 1, step: 1 },
    surfaceOp: 'append',
  }
  return row as SessionEvent
}

/** A contiguous log of alternating user/assistant messages. */
function log(records: number): SessionEvent[] {
  return Array.from({ length: records }, (_, index) => message(index, index % 2 === 0 ? 'user' : 'assistant'))
}

describe('bounded tail window pagination', () => {
  it('cuts the same page from a window as from the whole log', () => {
    const all = log(200)
    const cursor = SessionSeq(all.length - 1)
    for (const window of [3, 17, 60, all.length, all.length + 4]) {
      const base = Math.max(0, all.length - window)
      const sparse: SessionEvent[] = new Array<SessionEvent>(all.length)
      for (let index = base; index < all.length; index++) sparse[index] = all[index] as SessionEvent
      // The page budget equals the window: that is the invariant the bounded
      // read relies on, because paginate never walks below `end - maxEvents`.
      const whole = paginate(all, undefined, DEFAULT_MAX_MESSAGES, cursor, undefined, window)
      const bounded = paginate(sparse, undefined, DEFAULT_MAX_MESSAGES, cursor, undefined, window)
      expect(bounded.events).toEqual(whole.events)
      expect(bounded.hasMore).toBe(whole.hasMore)
    }
  })

  it('keeps absolute seqs and the hasMore edge when the window covers the tail', () => {
    const all = log(60)
    const base = all.length - 5
    const sparse: SessionEvent[] = new Array<SessionEvent>(all.length)
    for (let index = base; index < all.length; index++) sparse[index] = all[index] as SessionEvent
    const page = paginate(sparse, undefined, 2, SessionSeq(all.length - 1), undefined, 5)
    expect(page.events).toHaveLength(2)
    expect(page.events.at(-1)?.seq).toBe(all.length - 1)
    expect(page.hasMore).toBe(true)
  })

  it('reports the floor cut identically for a window that starts at the log head', () => {
    const all = log(4)
    const sparse: SessionEvent[] = new Array<SessionEvent>(all.length)
    for (let index = 0; index < all.length; index++) sparse[index] = all[index] as SessionEvent
    const page = paginate(sparse, undefined, DEFAULT_MAX_MESSAGES, SessionSeq(all.length - 1), undefined, all.length)
    expect(page.events).toEqual(all)
    expect(page.hasMore).toBe(false)
    expect(SessionLogOffset(all.length - page.events.length)).toBe(0)
  })
})

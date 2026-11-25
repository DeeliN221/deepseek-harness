import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventLines, scanLog, scanLogTail, toHeaderLine } from '../src/format.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'

/** One raw current-format log artifact: header record first, one record per event. */
function artifact(events: readonly SessionEvent[]): Buffer {
  const header = JSON.stringify(toHeaderLine(meta('tail-read-fixture', '/workspace/one')))
  return Buffer.from(`${header}\n${eventLines(events)}\n`)
}

const events = oneTurnLog()

describe('bounded tail scan', () => {
  it('returns exactly the records a full scan keeps for the same window', () => {
    const buffer = artifact(events)
    const full = scanLog(buffer)
    for (const maxEvents of [1, 2, events.length - 1, events.length, events.length + 5]) {
      const tail = scanLogTail(buffer, maxEvents)
      expect(tail.totalEvents).toBe(full.events.length)
      expect(tail.meta.id).toBe(full.meta.id)
      expect(tail.events).toEqual(full.events.slice(Math.max(0, full.events.length - maxEvents)))
      for (const [index, event] of tail.events.entries()) {
        expect(event.seq).toBe(full.events.length - tail.events.length + index)
      }
    }
  })

  it('reports the complete record count without decoding the skipped prefix', () => {
    const tail = scanLogTail(artifact(events), 1)
    expect(tail.totalEvents).toBe(events.length)
    expect(tail.events).toHaveLength(1)
    expect(tail.events[0]?.seq).toBe(events.length - 1)
  })

  it('ignores a torn final record exactly as a full scan does', () => {
    const torn = Buffer.concat([artifact(events), Buffer.from('{"type":"turn/end"')])
    const full = scanLog(torn)
    const tail = scanLogTail(torn, 2)
    expect(tail.totalEvents).toBe(full.events.length)
    expect(tail.events).toEqual(full.events.slice(-2))
  })

  it('refuses a record whose persisted seq does not match its row position', () => {
    const corrupted = events.map((event, index) => (
      index === events.length - 1 ? { ...event, seq: SessionSeq(99) } : event
    ))
    expect(() => scanLogTail(artifact(corrupted), 2)).toThrow(/carries seq 99/)
  })

  it('still refuses a log written by a foreign format version', () => {
    const header = { ...toHeaderLine(meta('tail-read-fixture', '/workspace/one')), version: 99 }
    const buffer = Buffer.from(`${JSON.stringify(header)}\n${eventLines(events)}\n`)
    expect(() => scanLogTail(buffer, 1)).toThrow(/format/)
  })

  it('rejects a non-positive window', () => {
    const buffer = artifact(events)
    expect(() => scanLogTail(buffer, 0)).toThrow(TypeError)
    expect(() => scanLogTail(buffer, -1)).toThrow(TypeError)
    expect(() => scanLogTail(buffer, 1.5)).toThrow(TypeError)
  })
})

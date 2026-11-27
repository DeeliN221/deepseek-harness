import { describe, expect, it } from 'vitest'
import {
  CHAT_RENDER_WINDOW_NODES, anchoredRenderWindow, earlierRenderWindow, historyRenderWindow,
  historyWindowTriggered, laterRenderWindow, renderWindowAnchor, resolveRenderWindow, savedAnchorIndex,
  tailRenderWindow,
} from '../src/client/chat/render-window.ts'

describe('history commit re-anchor', () => {
  it('treats a grown order as a history commit even when the first anchor sequence stays put', () => {
    expect(historyWindowTriggered({ firstSeq: null, orderLength: 42 }, { firstSeq: null, orderLength: 500 })).toBe(true)
    expect(historyWindowTriggered({ firstSeq: 1774, orderLength: 42 }, { firstSeq: 1774, orderLength: 500 })).toBe(true)
  })

  it('treats a changed first anchor sequence as a history commit', () => {
    expect(historyWindowTriggered({ firstSeq: 1510, orderLength: 42 }, { firstSeq: 1233, orderLength: 42 })).toBe(true)
  })

  it('does not re-anchor when neither the order nor its first anchor sequence changed', () => {
    expect(historyWindowTriggered({ firstSeq: 1510, orderLength: 42 }, { firstSeq: 1510, orderLength: 42 })).toBe(false)
  })

  it('keeps the whole previously mounted range below the retained head after a prepend', () => {
    const previous = { start: 600, end: 840 }
    const prepended = Array.from({ length: 500 }, (_, index) => `older-${index}`)
    const order = [...prepended, ...Array.from({ length: 840 }, (_, index) => `node-${index}`)]
    const anchorIndex = prepended.length + previous.start
    const range = historyRenderWindow(order.length, anchorIndex)
    expect(range.start).toBe(anchorIndex)
    expect(range.end - range.start).toBe(CHAT_RENDER_WINDOW_NODES)
    expect(range.end).toBeGreaterThanOrEqual(prepended.length + previous.end)
  })

  it('widens a stale narrow window to the full node budget instead of freezing its span', () => {
    const order = Array.from({ length: 900 }, (_, index) => `node-${index}`)
    const range = historyRenderWindow(order.length, 600)
    expect(range).toEqual({ start: 600, end: 840 })
    expect(resolveRenderWindow(order, 'session-a', renderWindowAnchor(order, 'session-a', range)))
      .toEqual({ start: 600, end: 840 })
  })
})

describe('bounded Chat render window', () => {
  it('keeps only the newest node budget in the initial projection', () => {
    expect(tailRenderWindow(8_851)).toEqual({ start: 8_611, end: 8_851 })
  })

  it('keeps a loaded anchor mounted when older history is prepended', () => {
    const order = Array.from({ length: 700 }, (_, index) => `node-${index}`)
    const anchor = renderWindowAnchor(order, 'session-a', { start: 460, end: 700 })
    expect(anchor).not.toBeNull()
    const prepended = [...Array.from({ length: 500 }, (_, index) => `older-${index}`), ...order]
    const index = prepended.indexOf(anchor?.firstKey ?? '')
    const range = anchoredRenderWindow(prepended.length, index, CHAT_RENDER_WINDOW_NODES,
      Math.floor(CHAT_RENDER_WINDOW_NODES * 0.75))
    expect(prepended.slice(range.start, range.end)).toContain(anchor?.firstKey)
    expect(range.end - range.start).toBe(CHAT_RENDER_WINDOW_NODES)
  })

  it('reveals older locally loaded nodes in a bounded slice before another page', () => {
    const current = { start: 600, end: 840 }
    const earlier = earlierRenderWindow(1_000, current)
    expect(earlier).toEqual({ start: 420, end: 660 })
    expect(earlier?.start).toBeLessThan(current.start)
    expect(earlier?.start).toBeGreaterThan(0)
    expect(earlier?.end).toBeLessThan(1_000)
    expect(earlierRenderWindow(1_000, { start: 0, end: 240 })).toBeNull()
  })

  it('advances an older bounded slice without treating its floor as the global tail', () => {
    expect(laterRenderWindow(1_000, { start: 580, end: 820 })).toEqual({ start: 640, end: 880 })
    expect(laterRenderWindow(1_000, { start: 760, end: 1_000 })).toBeNull()
  })

  it('resolves saved exact and split-node anchors before restore', () => {
    const order = ['node-a', 'node-b', 'node-c']
    expect(savedAnchorIndex(order, 'node-b')).toBe(1)
    expect(savedAnchorIndex(order, JSON.stringify(['node-b', 'assistant'] ))).toBe(1)
    expect(savedAnchorIndex(order, 'missing')).toBe(-1)
    expect(savedAnchorIndex(order, '[invalid')).toBe(-1)
  })

  it('renders empty and short sessions completely despite a stale anchor', () => {
    const anchor = { sessionId: 'session-a', firstKey: 'node-1', lastKey: 'node-2' }
    expect(resolveRenderWindow([], 'session-a', anchor)).toEqual({ start: 0, end: 0 })
    expect(resolveRenderWindow(['node-0', 'node-1', 'node-2'], 'session-a', anchor))
      .toEqual({ start: 0, end: 3 })
  })

  it('falls back to the current tail when an anchor is missing or belongs to another session', () => {
    expect(resolveRenderWindow(['new-a', 'new-b'], 'session-a', {
      sessionId: 'session-a', firstKey: 'removed', lastKey: 'also-removed',
    })).toEqual({ start: 0, end: 2 })
    const order = Array.from({ length: 300 }, (_, index) => `node-${index}`)
    expect(resolveRenderWindow(order, 'session-b', {
      sessionId: 'session-a', firstKey: 'node-0', lastKey: 'node-239',
    })).toEqual({ start: 60, end: 300 })
  })
})


it('pages both directions through more than 240 nodes and keeps historical windows stable on append', () => {
  const order = Array.from({ length: 1_000 }, (_, index) => `node-${index}`)
  let range = tailRenderWindow(order.length)
  while (range.start > 0) {
    const next = earlierRenderWindow(order.length, range)
    expect(next).not.toBeNull()
    if (next === null) throw new Error('Older rows became unreachable')
    expect(next.end - next.start).toBeLessThanOrEqual(240)
    expect(next.end).toBeGreaterThan(range.start)
    range = next
  }
  const anchor = renderWindowAnchor(order, 'session-a', range)
  const appended = [...order, 'node-1000']
  expect(resolveRenderWindow(appended, 'session-a', anchor)).toEqual(range)
  while (range.end < appended.length) {
    const next = laterRenderWindow(appended.length, range)
    expect(next).not.toBeNull()
    if (next === null) throw new Error('Newer rows became unreachable')
    expect(next.end - next.start).toBeLessThanOrEqual(240)
    expect(next.start).toBeLessThan(range.end)
    range = next
  }
  expect(appended.slice(range.start, range.end).at(-1)).toBe('node-1000')
  expect(resolveRenderWindow(appended, 'session-a', null)).toEqual(range)
})

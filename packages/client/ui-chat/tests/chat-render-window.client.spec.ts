import { describe, expect, it } from 'vitest'
import {
  CHAT_RENDER_WINDOW_NODES, anchoredRenderWindow, earlierRenderWindow, laterRenderWindow, renderWindowAnchor,
  resolveRenderWindow, savedAnchorIndex, tailRenderWindow,
} from '../src/client/chat/render-window.ts'

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

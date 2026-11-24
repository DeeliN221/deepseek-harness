// @vitest-environment jsdom
/** Chat scroll composition over the real viewport, reading owner, and fold lifecycle. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowMotionRows } from '../src/client/chat/flow-motion.ts'
import { earlierRenderWindow, laterRenderWindow } from '../src/client/chat/render-window.ts'
import { ChatViewport } from '../src/client/chat/use-chat-viewport.ts'
import { useChatScroll, type ChatScrollInput } from '../src/client/chat/use-chat-scroll.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  try {
    cleanup()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

function ScrollHarness({ input, onMotion }: {
  readonly input: ChatScrollInput
  readonly onMotion: (motion: FlowMotionRows) => void
}) {
  const state = useChatScroll(input)
  useLayoutEffect(() => { onMotion(state.motion) }, [onMotion, state.motion])
  return <>
    <div ref={state.listRef} data-testid="scrollport" data-initialized={state.initialized}>
      <div ref={state.columnRef} data-testid="column" data-chat-flow="" />
      <div data-chat-turn-spacer="" />
    </div>
    <button type="button" onClick={state.returnToBottom}>Return to bottom</button>
    <button type="button" onClick={state.loadEarlier}>Load earlier</button>
  </>
}

function mountScroll(deferCompletedTurns = true, initial: Partial<ChatScrollInput> = {}) {
  let input: ChatScrollInput = {
    isOpen: true,
    sessionId: 'session-1',
    order: [],
    firstSeq: null,
    lastKey: null,
    lastIsUser: false,
    steeringId: null,
    submissionId: null,
    submissionSteers: false,
    running: false,
    deferCompletedTurns,
    transcriptView: 'verbose',
    loadedTurns: [],
    hasMore: false,
    loadingOlder: false, historyLoadStatus: 'idle', consumeOlder: vi.fn(() => false),
    loadOlder: vi.fn(),
    loadThrough: vi.fn(async () => {}),
    chatScroll: { read: () => null, save: vi.fn() },
    ...initial,
    renderOrder: initial.renderOrder ?? initial.order ?? [],
    renderedGlobalTail: initial.renderedGlobalTail ?? true,
    advanceRenderWindow: initial.advanceRenderWindow ?? (() => false),
  }
  const callbacks: { motion?: FlowMotionRows; resize?: () => void } = {}
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.resize = () => { callback([], this) } }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { delete callbacks.resize }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  const onMotion = (motion: FlowMotionRows): void => { callbacks.motion = motion }
  const view = render(<ScrollHarness input={input} onMotion={onMotion} />)
  const scroller = within(view.container).getByTestId('scrollport')
  const spacer = scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')
  if (spacer === null) throw new Error('Missing fold spacer')
  let height = 1_000
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    if (options.behavior === 'instant') scroller.scrollTop = options.top ?? scroller.scrollTop
  })
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 },
    scrollHeight: { get: () => height + (Number.parseFloat(spacer.style.height) || 0) },
    scrollTo: { value: scrollTo },
  })
  const row = document.createElement('div')
  Object.defineProperty(row, 'offsetHeight', { value: 80 })
  within(view.container).getByTestId('column').append(row)
  return {
    view, scroller, scrollTo, row,
    resize: () => { act(() => { callbacks.resize?.() }) },
    grow: (next: number) => { height = next },
    update: (patch: Partial<ChatScrollInput>) => {
      const renderOrder = patch.renderOrder ?? (patch.order === undefined ? input.renderOrder : patch.order)
      input = { ...input, ...patch, renderOrder }
      view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
    },
    startFold: () => {
      const motion = callbacks.motion
      if (motion === undefined) throw new Error('Viewport motion callbacks are not bound')
      act(() => { motion.collapse(row, () => { row.hidden = true }) })
    },
    /** Run the fold's frame clock to its end (a row outside a batch finishes on its transition). */
    finishFold: () => {
      const event = new Event('transitionend', { bubbles: true })
      Object.defineProperty(event, 'propertyName', { value: 'height' })
      act(() => {
        row.dispatchEvent(event)
        vi.advanceTimersByTime(200)
      })
    },
  }
}

/** A scrollport of stacked rows whose boxes follow scrollTop; closing a row clamps like a browser. */
function mountRows(heights: readonly number[]) {
  const callbacks: { motion?: FlowMotionRows; resize?: () => void } = {}
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.resize = () => { callback([], this) } }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { delete callbacks.resize }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  const input: ChatScrollInput = {
    isOpen: true, sessionId: 'session-1', order: [], renderOrder: [], renderedGlobalTail: true, advanceRenderWindow: () => false,
    firstSeq: null, lastKey: null, lastIsUser: false,
    steeringId: null, submissionId: null, submissionSteers: false, running: false, deferCompletedTurns: false,
    transcriptView: 'standard', loadedTurns: [], hasMore: false, loadingOlder: false, historyLoadStatus: 'idle', consumeOlder: vi.fn(() => false),
    loadOlder: vi.fn(), loadThrough: vi.fn(async () => {}), chatScroll: { read: () => null, save: vi.fn() },
  }
  const view = render(<ScrollHarness input={input} onMotion={(motion) => { callbacks.motion = motion }}
  />)
  const scroller = within(view.container).getByTestId('scrollport')
  const column = within(view.container).getByTestId('column')
  const spacer = scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!
  const sizes = new Map<HTMLElement, number>()
  const rows = heights.map((height) => {
    const row = document.createElement('div')
    sizes.set(row, height)
    column.append(row)
    return row
  })
  const sizeOf = (row: HTMLElement): number => row.hidden ? 0 : sizes.get(row) ?? 0
  const docTop = (row: HTMLElement): number => {
    let top = 0
    for (const each of rows) {
      if (each === row) return top
      top += sizeOf(each)
    }
    return top
  }
  const content = (): number => rows.reduce((sum, row) => sum + sizeOf(row), 0)
  const room = (): number => Number.parseFloat(spacer.style.height) || 0
  const floor = (): number => Math.max(0, content() + room() - 400)
  let top = 0
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 },
    scrollHeight: { get: () => content() + room() },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, floor())) } },
    scrollTo: { value: (options: ScrollToOptions) => { top = Math.max(0, Math.min(options.top ?? top, floor())) } },
    getBoundingClientRect: { value: () => ({ top: 0, bottom: 400, height: 400 }) },
  })
  Object.defineProperty(column, 'offsetHeight', { get: content })
  for (const row of rows) {
    Object.defineProperty(row, 'getBoundingClientRect', { value: () => {
      const rowTop = docTop(row) - top
      return { top: rowTop, bottom: rowTop + sizeOf(row), height: sizeOf(row) }
    } })
  }
  const resize = (): void => { act(() => { callbacks.resize?.() }) }
  resize()
  const row = (index: number): HTMLElement => {
    const found = rows[index]
    if (found === undefined) throw new Error(`no row ${String(index)}`)
    return found
  }
  return {
    scroller, row, room, resize,
    top: () => top,
    screenTop: (row: HTMLElement) => docTop(row) - top,
    grow: (row: HTMLElement, by: number) => { sizes.set(row, (sizes.get(row) ?? 0) + by) },
    /** Close rows at once, as completion-time folding does, then let layout clamp and observe. */
    close: (...closing: HTMLElement[]) => {
      act(() => {
        for (const row of closing) callbacks.motion?.hideNow?.(row, () => { row.hidden = true })
        top = Math.min(top, floor())
        callbacks.resize?.()
      })
    },
    /** Close one row while the same commit grows another, as a Turn's duration control does. */
    closeGrowing: (closing: HTMLElement, grown: HTMLElement, by: number) => {
      act(() => {
        callbacks.motion?.hideNow?.(closing, () => { closing.hidden = true })
        sizes.set(grown, (sizes.get(grown) ?? 0) + by)
        top = Math.min(top, floor())
        callbacks.resize?.()
      })
    },
  }
}

describe('Chat scroll: a closing shrink keeps the content above still', () => {
  it('keeps the first visible row still and fills the gap below with room', () => {
    const h = mountRows([700, 100, 200])
    expect(h.top()).toBe(600)
    const [first, step, answer] = [h.row(0), h.row(1), h.row(2)]
    h.close(step)
    expect(h.screenTop(first)).toBe(-600)
    expect(h.screenTop(answer)).toBe(100)
    expect(h.room()).toBe(100)
  })

  it('moves nothing on screen when the closing rows are above the scrollport', () => {
    const h = mountRows([200, 300, 500])
    const [above, visible] = [h.row(0), h.row(2)]
    h.close(above)
    expect(h.screenTop(visible)).toBe(-100)
    expect(h.room()).toBe(0)
  })

  it('keeps the row that followed a closed first row on screen still', () => {
    const h = mountRows([500, 600, 100])
    const [steps, answer] = [h.row(1), h.row(2)]
    h.close(steps)
    expect(h.screenTop(answer)).toBe(300)
    expect(h.room()).toBe(0)
  })

  it('keeps the nearest surviving row above when no row followed a closed first row on screen', () => {
    const h = mountRows([500, 900])
    const [earlier, steps] = [h.row(0), h.row(1)]
    h.close(steps)
    // The earlier row would need more room than half the scrollport; the content end stops at the middle.
    expect(h.screenTop(earlier)).toBe(-300)
    expect(h.room()).toBe(200)
  })

  it('lets later growth take the room before following scrolls', () => {
    const h = mountRows([700, 100, 200])
    const [step, answer] = [h.row(1), h.row(2)]
    h.close(step)
    h.grow(answer, 60)
    h.resize()
    expect(h.room()).toBe(40)
    expect(h.top()).toBe(600)
  })

  it('leaves a reader away from the tail to the browser', () => {
    const h = mountRows([700, 100, 200])
    const step = h.row(1)
    fireEvent.wheel(h.scroller)
    h.scroller.scrollTop = 100
    fireEvent.scroll(h.scroller)
    act(() => { vi.advanceTimersByTime(500) })
    h.close(step)
    expect(h.room()).toBe(0)
  })

  it('uses the measurement only for the observation of the commit that closed the rows', () => {
    const h = mountRows([700, 100, 200])
    const [step, answer] = [h.row(1), h.row(2)]
    // Growth in the same commit outweighs the closed row, so nothing shrinks to compensate.
    h.closeGrowing(step, answer, 100)
    expect(h.room()).toBe(0)
    // A later shrink follows the tail like any other; the stale measurement does not pull the reader.
    h.grow(answer, -150)
    h.resize()
    expect(h.room()).toBe(0)
    expect(h.top()).toBe(450)
  })
})

const visibleFoldCases = [
  { name: 'E/E', earlier: 2400, steps: 1000, body: 400, viewport: 800, top: 800, input: 80, target: 2080, room: 0 },
  { name: 'E/T', earlier: 600, steps: 1000, body: 100, viewport: 800, top: 200, input: 80, target: 200, room: 220 },
  { name: 'E/B', earlier: 500, steps: 200, body: 400, viewport: 800, top: 200, input: 80, target: 200, room: 20 },
  { name: 'T/T', earlier: 500, steps: 2000, body: 100, viewport: 800, top: 900, input: 80, target: 500, room: 620 },
  { name: 'T/B', earlier: 500, steps: 1200, body: 400, viewport: 800, top: 1200, input: 80, target: 500, room: 320 },
  { name: 'B/B', earlier: 2400, steps: 1600, body: 1000, viewport: 800, top: 4200, input: 80, target: 2680, room: 0 },
  { name: 'short content', earlier: 100, steps: 300, body: 100, viewport: 800, top: 0, input: 80, target: 0, room: 0 },
  { name: 'larger input', earlier: 2000, steps: 300, body: 600, viewport: 800, top: 2100, input: 400, target: 2200, room: 0 },
  { name: 'body fills viewport', earlier: 900, steps: 300, body: 800, viewport: 800, top: 1200, input: 40, target: 940, room: 0 },
  { name: 'steps fill viewport', earlier: 900, steps: 800, body: 0, viewport: 800, top: 900, input: 0, target: 900, room: 800 },
  { name: 'input fills visible steps', earlier: 900, steps: 300, body: 500, viewport: 800, top: 900, input: 300, target: 900, room: 0 },
  { name: 'no steps', earlier: 900, steps: 0, body: 500, viewport: 800, top: 600, input: 40, target: 640, room: 0 },
  { name: 'input taller than viewport', earlier: 900, steps: 1200, body: 100, viewport: 800, top: 1400, input: 1200, target: 1400, room: 0 },
  { name: 'small viewport', earlier: 200, steps: 900, body: 100, viewport: 300, top: 900, input: 30, target: 200, room: 170 },
] as const

function mountVisibleFold(test: typeof visibleFoldCases[number], reduced: boolean, finalSiblingGrowth = 0) {
  let inputHeight = 0
  let submission = 0
  let top: number = test.top
  let motion: FlowMotionRows | undefined
  const onMotion = (value: FlowMotionRows): void => { motion = value }
  let input: ChatScrollInput = {
    isOpen: false, sessionId: 'session-1', order: [], renderOrder: [], renderedGlobalTail: true, advanceRenderWindow: () => false,
    firstSeq: null, lastKey: null, lastIsUser: false,
    steeringId: null, submissionId: null, submissionSteers: false, running: false, deferCompletedTurns: true,
    transcriptView: 'detailed', loadedTurns: [], hasMore: false, loadingOlder: false, historyLoadStatus: 'idle', consumeOlder: vi.fn(() => false),
    loadOlder: vi.fn(), loadThrough: vi.fn(async () => {}), chatScroll: { read: () => null, save: vi.fn() },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })))
  const view = render(<ScrollHarness input={input} onMotion={onMotion} />)
  const scroller = within(view.container).getByTestId('scrollport')
  const column = within(view.container).getByTestId('column')
  const spacer = scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!
  const row = document.createElement('div')
  const glyph = document.createElement('span')
  glyph.textContent = 'step text'
  row.append(glyph)
  column.append(row)
  const rowHeight = () => row.hidden ? 0 : (row.style.transition !== '' && row.style.transition !== 'none') || row.style.height === ''
    ? test.steps : Number.parseFloat(row.style.height)
  const room = () => Number.parseFloat(spacer.style.height) || 0
  const contentHeight = () => test.earlier + rowHeight() + test.body + inputHeight + (row.hidden ? finalSiblingGrowth : 0)
  const floor = () => Math.max(0, contentHeight() + room() - test.viewport)
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    scroller.scrollTop = options.top ?? scroller.scrollTop
  })
  Object.defineProperties(scroller, {
    clientHeight: { get: () => test.viewport },
    scrollHeight: { get: () => Math.max(test.viewport, contentHeight() + room()) },
    scrollTop: {
      get: () => { top = Math.max(0, Math.min(top, floor())); return top },
      set: (value: number) => { top = Math.max(0, Math.min(value, floor())) },
    },
    scrollTo: { value: scrollTo },
    getBoundingClientRect: { value: () => ({ top: 0, bottom: test.viewport, height: test.viewport }) },
  })
  Object.defineProperties(row, {
    offsetHeight: { get: rowHeight },
    getBoundingClientRect: { value: () => ({ top: test.earlier - top, bottom: test.earlier - top + rowHeight(), height: rowHeight() }) },
  })
  Object.defineProperties(column, {
    offsetHeight: { get: contentHeight },
    getBoundingClientRect: { value: () => ({ top: -top, bottom: contentHeight() - top, height: contentHeight() }) },
  })
  input = { ...input, isOpen: true }
  view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
  top = test.top
  scrollTo.mockClear()
  return {
    scroller, row, room, scrollTo,
    reopenAll(verbose = false) {
      act(() => { motion?.cancelMotion(row) })
      row.hidden = false
      if (verbose) {
        input = { ...input, transcriptView: 'verbose' }
        view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
      }
    },
    growDuringFold(height: number, newSubmission: boolean) {
      inputHeight += height
      input = newSubmission
        ? { ...input, submissionId: 'second-distinct-input' }
        : { ...input, order: ['new-stream-content'], renderOrder: ['new-stream-content'], running: true }
      view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
    },
    cancelReading() {
      fireEvent.wheel(scroller, { deltaY: -20 })
      scroller.scrollTop -= 20
      fireEvent.scroll(scroller)
      return scroller.scrollTop
    },
    updateInput() {
      input = { ...input, submissionId: null, lastKey: 'durable-input', lastIsUser: true }
      view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
    },
    bodyTop: () => test.earlier + rowHeight() - top,
    submit() {
      inputHeight += test.input
      row.hidden = false
      submission++
      act(() => {
        motion?.collapse(row, () => { row.hidden = true })
      })
      input = { ...input, submissionId: `visible-fold-input-${submission}` }
      view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
    },
  }
}

describe.each([false, true])('visible input-fold matrix (reduced=%s)', (reduced) => {
  it.each(['larger input', 'T/B'])('lands on final sibling spacing in the closing frame (%s)', async (name) => {
    const test = visibleFoldCases.find(test => test.name === name)!
    const h = mountVisibleFold(test, reduced, 4)
    h.submit()
    await act(async () => { await Promise.resolve() })
    for (let frame = 0; frame < 24 && !h.row.hidden; frame++) {
      act(() => { vi.advanceTimersByTime(16) })
    }
    expect(h.row.hidden).toBe(true)
    const target = test.target + (test.room === 0 ? 4 : 0)
    expect(h.scroller.scrollTop).toBe(target)
    expect(h.room()).toBe(Math.max(0, test.room - 4))
    act(() => { vi.advanceTimersByTime(500) })
    expect(h.scroller.scrollTop).toBe(target)
  })

  it.each(visibleFoldCases)('$name lands with only the required visible room', async (test) => {
    const h = mountVisibleFold(test, reduced)
    const positions = [h.bodyTop()]
    h.submit()
    await act(async () => { await Promise.resolve() })
    for (let frame = 0; frame < 24; frame++) {
      act(() => { vi.advanceTimersByTime(16) })
      positions.push(h.bodyTop())
    }
    expect(h.scroller.scrollTop).toBeCloseTo(test.target, 5)
    expect(h.room()).toBeCloseTo(test.room, 5)
    if (test.steps > 0) expect(h.scrollTo.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
    for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeLessThanOrEqual(positions[i - 1]! + 0.01)
    const end = h.bodyTop()
    act(() => { vi.advanceTimersByTime(500) })
    expect(h.bodyTop()).toBe(end)
  })
})

it('consumes a prior legal fold deficit instead of accumulating whole steps on the next input', async () => {
  const test = visibleFoldCases.find(test => test.name === 'T/B')!
  const h = mountVisibleFold(test, false)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(400) })
  expect(h.room()).toBe(320)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(400) })
  expect(h.scroller.scrollTop).toBe(500)
  expect(h.room()).toBe(240)
  expect(h.scrollTo).not.toHaveBeenCalled()
})

it('retains the reader position without clamping after an input fold is interrupted', async () => {
  const test = visibleFoldCases.find(test => test.name === 'B/B')!
  const h = mountVisibleFold(test, false)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(112) })
  const readingTop = h.cancelReading()
  act(() => { vi.advanceTimersByTime(400) })
  expect(h.scroller.scrollTop).toBe(readingTop)
  expect(h.scrollTo.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
})

it.each([false, true])('stops obsolete viewport writes when every closing row reopens (verbose=%s)', async (verbose) => {
  const test = visibleFoldCases.find(test => test.name === 'T/B')!
  const h = mountVisibleFold(test, false)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(112) })
  h.reopenAll(verbose)
  await act(async () => { await Promise.resolve() })
  const position = h.scroller.scrollTop
  act(() => { vi.advanceTimersByTime(400) })
  expect(h.room()).toBe(0)
  expect(h.scroller.scrollTop).toBe(position)
  expect(h.row.hidden).toBe(false)
  expect(h.row.style.height).toBe('')
  expect(h.scroller.querySelector('[data-input-fold]')).toBeNull()
  expect(h.scrollTo.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
})

it.each([false, true])('absorbs new height before the active fold finishes (new submission=%s)', async (newSubmission) => {
  const test = visibleFoldCases.find(test => test.name === 'B/B')!
  const h = mountVisibleFold(test, false)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(112) })
  h.growDuringFold(320, newSubmission)
  await act(async () => { await Promise.resolve() })
  const positions = [h.bodyTop()]
  for (let frame = 0; frame < 12; frame++) {
    act(() => { vi.advanceTimersByTime(16) })
    positions.push(h.bodyTop())
  }
  expect(h.scroller.scrollTop).toBe(test.target + 320)
  expect(h.room()).toBe(0)
  for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeLessThanOrEqual(positions[i - 1]! + 0.01)
  const settled = h.scroller.scrollTop
  act(() => { vi.advanceTimersByTime(500) })
  expect(h.scroller.scrollTop).toBe(settled)
  expect(h.scrollTo.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
})

it('keeps one active fold when the local echo becomes its durable input', async () => {
  const test = visibleFoldCases.find(test => test.name === 'B/B')!
  const h = mountVisibleFold(test, false)
  h.submit()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(96) })
  const halfway = h.bodyTop()
  h.updateInput()
  await act(async () => { await Promise.resolve() })
  act(() => { vi.advanceTimersByTime(400) })
  expect(h.scroller.scrollTop).toBe(test.target)
  expect(h.room()).toBe(0)
  expect(h.bodyTop()).toBeLessThanOrEqual(halfway)
  expect(h.scrollTo.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
})

describe('Chat scroll collapse timing', () => {
  it.each(['resize', 'scroll', 'history', 'input', 'preference'] as const)(
    'waits for initial history before initializing a running view after %s', (change) => {
      const h = mountScroll(true, { isOpen: false, running: true })
      expect(h.scroller.dataset.initialized).toBe('false')
      if (change === 'resize') h.resize()
      else if (change === 'scroll') fireEvent.scroll(h.scroller)
      else if (change === 'history') h.update({ order: ['history'], lastKey: 'history' })
      else if (change === 'input') h.update({ submissionId: 'pending-input' })
      else h.update({ transcriptView: 'standard' })
      expect(h.scroller.dataset.initialized).toBe('false')
      expect(h.scroller.scrollTop).toBe(0)
      expect(h.scrollTo).not.toHaveBeenCalled()

      h.update({ isOpen: true })
      expect(h.scroller.dataset.initialized).toBe('true')
      expect(h.scroller.scrollTop).toBe(600)
      expect(h.scrollTo).not.toHaveBeenCalled()
      h.grow(1_200)
      h.resize()
      expect(h.scroller.scrollTop).toBe(800)
    },
  )

  it('does not defer one viewport\'s submitted input behind another viewport\'s fold', () => {
    const first = mountScroll()
    const second = mountScroll()
    first.startFold()
    second.update({ submissionId: 'second-view-input' })
    expect(second.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
    expect(second.scroller.style.overflowAnchor).toBe('')
    first.finishFold()
    expect(second.scrollTo).toHaveBeenCalledTimes(1)
    expect(first.scrollTo).not.toHaveBeenCalled()
  })

  it.each([false, true])('follows submitted input with deferCompletedTurns=%s', (deferred) => {
    const h = mountScroll(deferred)
    h.update({ submissionId: 'first' })
    if (deferred) {
      expect(h.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
      expect(h.scroller.scrollTop).toBe(0)
    } else {
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(600)
    }
  })

  it.each([
    ['a local steering echo', { submissionId: 'steer', submissionSteers: true }],
    ['a pending steering message', { steeringId: 'inbox-steer' }],
  ] as const)('lands %s at once under either fold timing', (_, change) => {
    for (const deferred of [false, true]) {
      const h = mountScroll(deferred)
      h.update(change)
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(600)
      h.view.unmount()
    }
  })

  it('coalesces submitted inputs into one frame-owned fold', async () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.update({ submissionId: 'second' })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    await act(async () => { await Promise.resolve() })
    // The folded row leaves the committed layout; the landing reads the actual content height.
    h.grow(920)
    act(() => { vi.advanceTimersByTime(400) })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(520)
    expect(h.scroller.style.overflowAnchor).toBe('')
  })

  it('keeps only the visible deficit when submitted input is smaller than the fold', async () => {
    const test = visibleFoldCases.find(test => test.name === 'T/B')!
    const h = mountVisibleFold(test, false)
    h.submit()
    await act(async () => { await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(400) })
    expect(h.scroller.scrollTop).toBe(500)
    expect(h.room()).toBe(320)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it.each([false, true])('clears mode-change bottom space after the fold (reader interrupts=%s)', async (interrupt) => {
    const h = mountScroll()
    h.resize()
    h.startFold()
    h.update({ transcriptView: 'standard' })
    await act(async () => { await Promise.resolve() })
    const spacer = h.scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!
    expect(spacer.style.height).toBe('80px')
    h.grow(920)
    if (interrupt) {
      fireEvent.wheel(h.scroller, { deltaY: -100 })
      h.scroller.scrollTop = 400
      fireEvent.scroll(h.scroller)
    }
    h.finishFold()
    expect(spacer.style.height).toBe('')
    expect(h.scroller.scrollHeight).toBe(920)
    expect(h.scroller.scrollTop).toBe(interrupt ? 400 : 520)
    expect(h.row.hidden).toBe(true)
    h.resize()
    expect(spacer.style.height).toBe('')
  })

  it('clears a previous fold reservation on an idle mode change', async () => {
    const h = mountScroll()
    h.resize()
    h.startFold()
    await act(async () => { await Promise.resolve() })
    h.grow(920)
    h.finishFold()
    h.resize()
    expect(h.scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!.style.height).toBe('80px')
    h.update({ transcriptView: 'standard' })
    expect(h.scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!.style.height).toBe('')
    expect(h.scroller.scrollTop).toBe(520)
  })

  it('keeps the latest mode reset when preferences change before a fold finishes', async () => {
    const h = mountScroll()
    h.resize()
    h.startFold()
    h.update({ transcriptView: 'standard' })
    await act(async () => { await Promise.resolve() })
    h.update({ transcriptView: 'detailed' })
    h.grow(920)
    h.finishFold()
    expect(h.scroller.querySelector<HTMLElement>('[data-chat-turn-spacer]')!.style.height).toBe('')
    expect(h.scroller.scrollTop).toBe(520)
  })

  it('combines the remaining input distance with the smaller fold', async () => {
    const test = visibleFoldCases.find(test => test.name === 'larger input')!
    const h = mountVisibleFold(test, false)
    h.submit()
    await act(async () => { await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(400) })
    expect(h.scroller.scrollTop).toBe(2200)
    expect(h.room()).toBe(0)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'] as const)(
    'cancels queued follow when the reader sends %s input', async (intent) => {
      const h = mountScroll()
      h.startFold()
      h.update({ submissionId: 'first' })
      await act(async () => { await Promise.resolve() })
      if (intent === 'wheel') fireEvent.wheel(h.scroller, { deltaY: -80 })
      else if (intent === 'touchstart') fireEvent.touchStart(h.scroller)
      else if (intent === 'pointerdown') fireEvent.pointerDown(h.scroller, { button: 0 })
      else fireEvent.keyDown(h.scroller, { key: 'ArrowUp' })
      h.finishFold()
      act(() => { vi.runAllTimers() })
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(0)
    },
  )

  it.each([false, true])('keeps a fold cancelled through resize until new input owns follow (new input=%s)', async (newInput) => {
    const h = mountScroll()
    h.scroller.scrollTop = 500
    h.startFold()
    h.update({ submissionId: 'first' })
    await act(async () => { await Promise.resolve() })
    fireEvent.wheel(h.scroller, { deltaY: -80 })
    h.scroller.scrollTop = 420
    fireEvent.scroll(h.scroller)
    h.resize()
    h.update({ order: ['streaming-change'], running: true })
    if (newInput) h.update({ submissionId: 'second' })
    h.grow(920)
    h.finishFold()
    await act(async () => { await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(400) })
    if (newInput) expect(h.scroller.scrollTop).toBe(520)
    else {
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(420)
      act(() => { vi.advanceTimersByTime(500) })
      h.resize()
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(420)
    }
  })

  it('keeps intent cancellation through a resize before the first scroll delivery', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    fireEvent.wheel(h.scroller, { deltaY: -80 })
    h.resize()
    h.finishFold()
    expect(h.scrollTo).not.toHaveBeenCalled()
    h.update({ submissionId: 'second' })
    expect(h.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
  })

  it('does not let process-body scrollend settle an outer native follow', () => {
    const h = mountScroll()
    const body = document.createElement('div')
    body.dataset.stepProcessBody = ''
    h.row.append(body)
    h.update({ submissionId: 'first' })
    h.scroller.scrollTop = 150
    fireEvent.scroll(h.scroller)
    fireEvent(body, new Event('scrollend', { bubbles: true }))
    h.grow(1_200)
    h.resize()
    expect(h.scrollTo.mock.calls).toEqual([
      [{ top: 600, behavior: 'smooth' }],
      [{ top: 800, behavior: 'smooth' }],
    ])
    h.scroller.scrollTop = 800
    fireEvent.scroll(h.scroller)
    fireEvent(h.scroller, new Event('scrollend'))
    h.grow(1_300)
    h.resize()
    expect(h.scroller.scrollTop).toBe(900)
  })

  it('cancels queued follow when the Chat view unmounts', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.view.unmount()
    h.finishFold()
    act(() => { vi.runAllTimers() })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    expect(h.scroller.style.overflowAnchor).toBe('')
  })

  it('does not revive a cancelled follow when delayed timing is re-enabled before the fold ends', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.update({ deferCompletedTurns: false })
    h.update({ deferCompletedTurns: true })
    h.finishFold()
    act(() => { vi.runAllTimers() })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    h.update({ deferCompletedTurns: false, submissionId: 'second' })
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it('returns to bottom immediately and cancels an older fold waiter', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    fireEvent.click(h.view.getByRole('button', { name: 'Return to bottom' }))
    expect(h.scroller.scrollTop).toBe(600)
    h.grow(1_200)
    h.finishFold()
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it('interrupts an active smooth follow when completion timing is restored', () => {
    const h = mountScroll()
    h.update({ submissionId: 'first' })
    h.scroller.scrollTop = 150
    h.update({ deferCompletedTurns: false })
    expect(h.scrollTo).toHaveBeenLastCalledWith({ top: 150, behavior: 'instant' })
    expect(h.scroller.scrollTop).toBe(150)
    h.update({ submissionId: 'second' })
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).toHaveBeenCalledTimes(2)
  })
})


describe('forward reading at a bounded local floor', () => {
  it('advances on wheel without a scroll event even when the slice has no visible anchor', () => {
    const advanceRenderWindow = vi.fn(() => true)
    const h = mountScroll(false, { renderedGlobalTail: false, advanceRenderWindow })
    const scroll = vi.fn()
    h.scroller.addEventListener('scroll', scroll)
    h.scroller.scrollTop = 600
    fireEvent.wheel(h.scroller, { deltaY: 15_000 })
    expect(scroll).not.toHaveBeenCalled()
    expect(advanceRenderWindow).toHaveBeenCalledOnce()
    expect(h.scroller.scrollTop).toBe(600)
  })

  it('requires forward intent at the floor and leaves scrollable inner bodies to the browser', () => {
    const advanceRenderWindow = vi.fn(() => true)
    const h = mountScroll(false, { renderedGlobalTail: false, advanceRenderWindow })
    h.scroller.scrollTop = 500
    fireEvent.wheel(h.scroller, { deltaY: 100 })
    h.scroller.scrollTop = 600
    fireEvent.wheel(h.scroller, { deltaY: -100 })
    fireEvent.wheel(h.scroller, { deltaY: 100, ctrlKey: true })
    fireEvent.pointerDown(h.scroller)
    fireEvent.keyDown(h.scroller, { key: 'ArrowUp' })
    fireEvent.keyDown(h.scroller, { key: ' ', shiftKey: true })
    const body = document.createElement('div')
    body.setAttribute('data-step-process-body', '')
    Object.defineProperties(body, { scrollHeight: { value: 1_000 }, clientHeight: { value: 100 } })
    h.scroller.append(body)
    fireEvent.wheel(body, { deltaY: 100 })
    expect(advanceRenderWindow).not.toHaveBeenCalled()
    body.scrollTop = 900
    fireEvent.wheel(body, { deltaY: 100 })
    expect(advanceRenderWindow).toHaveBeenCalledOnce()
    h.update({ renderedGlobalTail: true })
    fireEvent.keyDown(h.scroller, { key: 'PageDown' })
    expect(advanceRenderWindow).toHaveBeenCalledOnce()
  })

  it('retains the semantic reading anchor before advancing the slice', () => {
    const preserve = vi.spyOn(ChatViewport.prototype, 'beginPreserving')
    const advanceRenderWindow = vi.fn(() => true)
    const h = mountScroll(false, { renderedGlobalTail: false, advanceRenderWindow })
    h.row.dataset.chatFlowKey = 'node-599'
    h.row.dataset.chatAnchorKey = 'node-599'
    h.row.textContent = 'Visible reading anchor'
    h.scroller.scrollTop = 599.5
    fireEvent.keyDown(h.scroller, { key: 'PageDown' })
    expect(preserve).toHaveBeenLastCalledWith({ anchorKey: 'node-599', anchorTop: 0, scrollTop: 599.5 })
    expect(advanceRenderWindow).toHaveBeenCalledOnce()
  })

  it('keeps live append away from the reader and lands at the new global floor after return-bottom', () => {
    const order = Array.from({ length: 700 }, (_, index) => `node-${index}`)
    const h = mountScroll(false, {
      order, renderOrder: order.slice(100, 340), renderedGlobalTail: false, advanceRenderWindow: () => true,
    })
    h.scroller.scrollTop = 600
    fireEvent.wheel(h.scroller, { deltaY: 100 })
    h.scrollTo.mockClear()
    const appended = [...order, 'node-700']
    h.update({ order: appended, renderOrder: order.slice(100, 340), lastKey: 'node-700' })
    expect(h.scrollTo).not.toHaveBeenCalled()
    fireEvent.click(within(h.view.container).getByRole('button', { name: 'Return to bottom' }))
    h.grow(1_600)
    h.update({ renderOrder: appended.slice(-240), renderedGlobalTail: true })
    expect(h.scroller.scrollTop).toBe(1_200)
  })
})


it.each([true, false])('does not pull a committed forward page back toward older rows (remote hasMore=%s)', (hasMore) => {
  const order = Array.from({ length: 1_000 }, (_, index) => `node-${index}`)
  let bounds = { start: 400, end: 640 }
  const revealEarlier = vi.fn(() => {
    const next = earlierRenderWindow(order.length, bounds)
    if (next === null) return false
    bounds = next
    return true
  })
  const h = mountScroll(false, {
    order, renderOrder: order.slice(bounds.start, bounds.end), renderedGlobalTail: false,
    hasMore, revealEarlier,
    advanceRenderWindow: () => {
      const next = laterRenderWindow(order.length, bounds)
      if (next === null) return false
      bounds = next
      return true
    },
  })
  // jsdom has no layout or ResizeObserver entries; derive the edge from this real scrollport.
  vi.spyOn(ChatViewport.prototype, 'confirmHistoryStart').mockImplementation(() => h.scroller.scrollTop === 0)
  for (let page = 0; page < 3; page++) {
    h.scroller.scrollTop = 600
    fireEvent.wheel(h.scroller, { deltaY: 15_000 })
    expect(bounds).toEqual({ start: 460 + page * 60, end: 700 + page * 60 })
    h.update({ renderOrder: order.slice(bounds.start, bounds.end) })
    act(() => { vi.advanceTimersByTime(32) })
    expect(revealEarlier).not.toHaveBeenCalled()
    expect(bounds).toEqual({ start: 460 + page * 60, end: 700 + page * 60 })
  }
  h.scroller.scrollTop = 0
  fireEvent.scroll(h.scroller)
  fireEvent(h.scroller, new Event('scrollend'))
  act(() => { vi.advanceTimersByTime(32) })
  expect(revealEarlier).toHaveBeenCalledOnce()
  expect(bounds).toEqual({ start: 400, end: 640 })
})


it.each([
  { name: 'a successful local page', hasMore: true, start: 400, expectedStart: 220 },
  { name: 'exhausted local and remote history', hasMore: false, start: 0, expectedStart: 0 },
])('consumes a manual history click after $name before forward reading', ({ hasMore, start, expectedStart }) => {
  const order = Array.from({ length: 1_000 }, (_, index) => `node-${index}`)
  let bounds = { start, end: start + 240 }
  const loadOlder = vi.fn()
  const h = mountScroll(false, {
    order, renderOrder: order.slice(bounds.start, bounds.end), renderedGlobalTail: false,
    hasMore, loadOlder,
    revealEarlier: () => {
      const next = earlierRenderWindow(order.length, bounds)
      if (next === null) return false
      bounds = next
      return true
    },
    advanceRenderWindow: () => {
      const next = laterRenderWindow(order.length, bounds)
      if (next === null) return false
      bounds = next
      return true
    },
  })
  vi.spyOn(ChatViewport.prototype, 'confirmHistoryStart').mockImplementation(() => h.scroller.scrollTop === 0)
  h.scroller.scrollTop = 600
  fireEvent.click(within(h.view.container).getByRole('button', { name: 'Load earlier' }))
  h.update({ renderOrder: order.slice(bounds.start, bounds.end) })
  if (!hasMore) act(() => { vi.advanceTimersByTime(32) })
  expect(bounds).toEqual({ start: expectedStart, end: expectedStart + 240 })
  expect(loadOlder).not.toHaveBeenCalled()

  for (let page = 1; page <= 3; page++) {
    h.scroller.scrollTop = 600
    fireEvent.wheel(h.scroller, { deltaY: 15_000 })
    const expected = { start: expectedStart + page * 60, end: expectedStart + page * 60 + 240 }
    expect(bounds).toEqual(expected)
    h.update({ renderOrder: order.slice(bounds.start, bounds.end) })
    act(() => { vi.advanceTimersByTime(32) })
    expect(bounds).toEqual(expected)
  }
  expect(loadOlder).not.toHaveBeenCalled()
})

import { describe, expect, it, vi } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ChatScrollPosition } from '../src/client/contract/slots.ts'
import type { ChatNavigationInput } from '../src/client/chat/use-chat-navigation.ts'
import { ChatNavigation } from '../src/client/chat/use-chat-navigation.ts'
import type { TurnRailItem } from '../src/client/chat/turn-rail-items.ts'
import type { ViewportLanding } from '../src/client/chat/use-chat-viewport.ts'

type NavigationViewport = ConstructorParameters<typeof ChatNavigation>[0]
type NavigationReading = ConstructorParameters<typeof ChatNavigation>[1]

const oldPosition: ChatScrollPosition = { anchorKey: 'n800', anchorTop: 40, scrollTop: 340 }
const oldLanding: ViewportLanding = {
  metrics: { top: 340, floor: 800, height: 200 }, position: oldPosition, turn: 80,
}
const targetPosition: ChatScrollPosition = { anchorKey: 'n740', anchorTop: 24, scrollTop: 376 }
const targetLanding: ViewportLanding = {
  metrics: { top: 376, floor: 800, height: 200 }, position: targetPosition, turn: 74,
}

function makeViewport(overrides: Partial<NavigationViewport> = {}): NavigationViewport {
  let retained: ViewportLanding | null = null
  const base: NavigationViewport = {
    get preserving() { return retained !== null },
    beginPreserving: vi.fn((position: ChatScrollPosition | null = oldPosition) => {
      retained = position === null ? null : { ...oldLanding, position }
    }),
    beginPaging: vi.fn(() => { retained = oldLanding }),
    stopPreserving: vi.fn(() => { retained = null }),
    preserve: vi.fn(() => retained),
    capturePosition: vi.fn(() => retained?.position ?? oldPosition),
    scrollToTurn: vi.fn(() => null),
    scrollToTurnAtOrAfter: vi.fn(() => null),
  }
  return { ...base, ...overrides }
}

function makeReading(overrides: Partial<NavigationReading> = {}): NavigationReading {
  const base: NavigationReading = {
    pending: false,
    followingTail: false,
    pauseFollowing: vi.fn(),
    acceptNavigation: vi.fn(),
    preservePosition: vi.fn(),
  }
  return { ...base, ...overrides }
}

function input(overrides: Partial<ChatNavigationInput> = {}): ChatNavigationInput {
  return {
    sessionId: 'session-1', firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
    loadOlder: vi.fn(), loadThrough: vi.fn<ChatNavigationInput['loadThrough']>(async () => {}),
    ...overrides,
  }
}

describe('ChatNavigation', () => {
  it('falls back after a committed local reveal still cannot find the target anchor', async () => {
    let releasePage!: () => void
    const page = new Promise<void>((resolve) => { releasePage = resolve })
    const revealTurn = vi.fn<(turn: number) => boolean>()
      .mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValue(false)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const fallback = vi.fn(() => targetLanding)
    const viewport = makeViewport({ scrollToTurnAtOrAfter: fallback })
    const acceptNavigation = vi.fn()
    const navigation = new ChatNavigation(
      viewport, makeReading({ acceptNavigation }), input({ loadThrough, revealTurn }), vi.fn(),
    )
    const item: TurnRailItem = {
      turn: 1, prompt: 'older prompt', response: '',
      anchor: { kind: 'unloaded', seq: SessionSeq(0) },
    }

    navigation.navigateToTurn(item)
    expect(loadThrough).toHaveBeenCalledWith(SessionSeq(0))
    expect(navigation.contentCommitted()).toBe(true)
    expect(revealTurn).toHaveBeenCalledTimes(2)
    expect(navigation.contentCommitted()).toBe(false)
    expect(revealTurn).toHaveBeenCalledTimes(3)
    releasePage()
    await page

    expect(fallback).toHaveBeenCalledWith(1)
    expect(acceptNavigation).toHaveBeenCalledWith(targetLanding)
  })

  it('reveals a loaded hidden Turn by its durable outline seq without paging', () => {
    const seq = SessionSeq(12)
    const revealThrough = vi.fn(() => true)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const scrollToTurn = vi.fn().mockReturnValueOnce(null).mockReturnValue(targetLanding)
    const viewport = makeViewport({ scrollToTurn })
    const acceptNavigation = vi.fn()
    const navigation = new ChatNavigation(
      viewport, makeReading({ acceptNavigation }), input({ loadThrough, revealThrough }), vi.fn(),
    )

    navigation.navigateToTurn({
      turn: 7, prompt: 'loaded prompt', response: '',
      anchor: { kind: 'loaded', key: 'turn-7-anchor', seq },
    })

    expect(revealThrough).toHaveBeenCalledWith(7, seq)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(navigation.contentCommitted()).toBe(true)
    expect(acceptNavigation).toHaveBeenCalledWith(targetLanding)
    expect(viewport.preserving).toBe(false)
  })

  it('retries local reveal pages until a loaded hidden Turn can be mounted', () => {
    const seq = SessionSeq(14)
    const revealThrough = vi.fn(() => true)
    const scrollToTurn = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(null)
      .mockReturnValueOnce(null).mockReturnValue(targetLanding)
    const viewport = makeViewport({ scrollToTurn })
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const acceptNavigation = vi.fn()
    const navigation = new ChatNavigation(
      viewport, makeReading({ acceptNavigation }), input({ loadThrough, revealThrough }), vi.fn(),
    )

    navigation.navigateToTurn({
      turn: 8, prompt: 'older prompt', response: '',
      anchor: { kind: 'loaded', key: 'turn-8-anchor', seq },
    })
    expect(revealThrough).toHaveBeenCalledTimes(1)
    expect(loadThrough).not.toHaveBeenCalled()

    expect(navigation.contentCommitted()).toBe(true)
    expect(navigation.contentCommitted()).toBe(true)
    expect(navigation.contentCommitted()).toBe(true)
    expect(revealThrough).toHaveBeenCalledTimes(3)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(acceptNavigation).toHaveBeenCalledWith(targetLanding)
    expect(viewport.preserving).toBe(false)
  })

  it('reveals a locally loaded target before Session.loadThrough even while its rail mark is unloaded', () => {
    const seq = SessionSeq(20)
    const revealThrough = vi.fn(() => true)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const acceptNavigation = vi.fn()
    const navigation = new ChatNavigation(
      makeViewport({ scrollToTurn: vi.fn(() => targetLanding) }),
      makeReading({ acceptNavigation }), input({ loadThrough, revealThrough }), vi.fn(),
    )

    navigation.navigateToTurn({
      turn: 9, prompt: 'already loaded', response: '', anchor: { kind: 'unloaded', seq },
    })

    expect(revealThrough).toHaveBeenCalledWith(9, seq)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(navigation.contentCommitted()).toBe(true)
    expect(acceptNavigation).toHaveBeenCalledWith(targetLanding)
  })

  it('does not request another page when the inclusive window begins at the target seq', async () => {
    const seq = SessionSeq(5)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const fallback = vi.fn(() => targetLanding)
    const navigation = new ChatNavigation(
      makeViewport({ scrollToTurnAtOrAfter: fallback }), makeReading(),
      input({ firstSeq: seq, loadThrough, revealThrough: vi.fn(() => false), revealTurn: vi.fn(() => false) }),
      vi.fn(),
    )

    navigation.navigateToTurn({
      turn: 6, prompt: 'target prompt', response: '', anchor: { kind: 'unloaded', seq },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(loadThrough).toHaveBeenCalledTimes(1)
    expect(loadThrough).toHaveBeenCalledWith(seq)
    expect(fallback).toHaveBeenCalledWith(6)
  })

  it('ignores a page completion after its session owner resets navigation', async () => {
    let releasePage!: () => void
    const page = new Promise<void>((resolve) => { releasePage = resolve })
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const scrollToTurn = vi.fn(() => null)
    const fallback = vi.fn(() => null)
    const onBusyTurn = vi.fn()
    const navigation = new ChatNavigation(
      makeViewport({ scrollToTurn, scrollToTurnAtOrAfter: fallback }), makeReading(),
      input({ loadThrough, revealThrough: vi.fn(() => false), revealTurn: vi.fn(() => false) }), onBusyTurn,
    )

    navigation.navigateToTurn({
      turn: 4, prompt: 'remote prompt', response: '', anchor: { kind: 'unloaded', seq: SessionSeq(3) },
    })
    navigation.reset()
    releasePage()
    await page

    expect(scrollToTurn).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
    expect(onBusyTurn).toHaveBeenLastCalledWith(null)
  })

  it.each([
    { name: 'loaded-hidden', anchor: { kind: 'loaded', key: 'n740', seq: SessionSeq(74) } as const },
    { name: 'unloaded-but-local', anchor: { kind: 'unloaded', seq: SessionSeq(74) } as const },
  ])('keeps a local landing after later layout commits ($name)', ({ anchor }) => {
    const rows = new Map([['n800', 380], ['n740', 400]])
    let scrollTop = 340
    let paging: { position: ChatScrollPosition; top: number } | null = null
    let currentPosition = oldPosition
    const viewport: NavigationViewport = {
      get preserving() { return paging !== null },
      beginPreserving: (position?: ChatScrollPosition | null) => {
        const retained = position === undefined ? currentPosition : position
        paging = retained === null ? null : { position: retained, top: rows.get(retained.anchorKey)! - scrollTop }
      },
      beginPaging: () => {},
      stopPreserving: () => { paging = null },
      preserve: () => {
        if (paging === null) return null
        const top = (rows.get(paging.position.anchorKey) ?? 0) - scrollTop
        scrollTop += top - paging.top
        currentPosition = { ...paging.position, scrollTop }
        return { metrics: { top: scrollTop, floor: 800, height: 200 }, position: currentPosition, turn: 80 }
      },
      capturePosition: () => currentPosition,
      scrollToTurn: vi.fn().mockReturnValueOnce(null).mockImplementation(() => {
        scrollTop = rows.get('n740')! - 24
        currentPosition = { ...targetPosition, scrollTop }
        return { metrics: { top: scrollTop, floor: 800, height: 200 }, position: currentPosition, turn: 74 }
      }),
      scrollToTurnAtOrAfter: () => null,
    }
    const saved: { position: ChatScrollPosition | null } = { position: null }
    const acceptNavigation = vi.fn((landing: ViewportLanding) => { saved.position = landing.position })
    const revealThrough = vi.fn(() => true)
    const navigation = new ChatNavigation(
      viewport, makeReading({ acceptNavigation }),
      input({ revealThrough }), vi.fn(),
    )

    navigation.navigateToTurn({ turn: 74, prompt: 'target', response: '', anchor })
    expect(currentPosition.anchorKey).toBe('n800')
    expect(navigation.contentCommitted()).toBe(true)
    if (anchor.kind === 'unloaded') {
      expect(scrollTop).toBe(340)
      expect(viewport.preserving).toBe(true)
      expect(navigation.contentCommitted()).toBe(true)
    }
    expect(scrollTop).toBe(376)
    expect(saved.position?.anchorKey).toBe('n740')
    expect(viewport.preserving).toBe(false)

    expect(navigation.contentCommitted()).toBe(false)
    expect(scrollTop).toBe(376)
    expect(saved.position?.anchorKey).toBe('n740')
  })
})

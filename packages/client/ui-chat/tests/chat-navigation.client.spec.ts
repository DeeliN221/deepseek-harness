import { describe, expect, it, vi } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ChatNavigationInput } from '../src/client/chat/use-chat-navigation.ts'
import { ChatNavigation } from '../src/client/chat/use-chat-navigation.ts'
import type { TurnRailItem } from '../src/client/chat/turn-rail-items.ts'
import type { ChatReading } from '../src/client/chat/use-chat-reading.ts'
import type { ChatViewport, ViewportLanding } from '../src/client/chat/use-chat-viewport.ts'

describe('ChatNavigation', () => {
  it('falls back after a committed local reveal still cannot find the target anchor', async () => {
    let releasePage!: () => void
    const page = new Promise<void>((resolve) => { releasePage = resolve })
    const revealTurn = vi.fn<(turn: number) => boolean>()
      .mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValue(false)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const input: ChatNavigationInput = {
      sessionId: 'session-1', firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough, revealTurn,
    }
    const landing = {} as ViewportLanding
    const scrollToTurnAtOrAfter = vi.fn(() => landing)
    const acceptNavigation = vi.fn()
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(),
      stopPreserving: vi.fn(),
      preserve: vi.fn(() => null),
      scrollToTurn: vi.fn(() => null),
      scrollToTurnAtOrAfter,
    } as unknown as ChatViewport
    const reading = {
      pending: false,
      followingTail: false,
      pauseFollowing: vi.fn(),
      acceptNavigation,
      preservePosition: vi.fn(),
    } as unknown as ChatReading
    const onBusyTurn = vi.fn()
    const navigation = new ChatNavigation(viewport, reading, input, onBusyTurn)
    const item: TurnRailItem = {
      turn: 1, prompt: 'older prompt', response: '',
      anchor: { kind: 'unloaded', seq: SessionSeq(0) },
    }

    navigation.navigateToTurn(item)
    expect(loadThrough).toHaveBeenCalledWith(SessionSeq(0))
    expect(navigation.contentCommitted()).toBe(false)
    expect(revealTurn).toHaveBeenCalledTimes(2)

    // The reveal state commits without mounting the anchor; reconciliation must not stay stuck.
    expect(navigation.contentCommitted()).toBe(false)
    expect(revealTurn).toHaveBeenCalledTimes(3)
    releasePage()
    await page

    expect(scrollToTurnAtOrAfter).toHaveBeenCalledWith(1)
    expect(acceptNavigation).toHaveBeenCalledWith(landing)
    expect(onBusyTurn).toHaveBeenLastCalledWith(null)
  })

  it('reveals a loaded hidden Turn by its durable outline seq without paging', () => {
    const seq = SessionSeq(12)
    const revealThrough = vi.fn(() => true)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const input: ChatNavigationInput = {
      sessionId: 'session-1', firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough, revealThrough,
    }
    const landing = {} as ViewportLanding
    const acceptNavigation = vi.fn()
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(),
      stopPreserving: vi.fn(),
      preserve: vi.fn(() => null),
      scrollToTurn: vi.fn().mockReturnValueOnce(null).mockReturnValue(landing),
      scrollToTurnAtOrAfter: vi.fn(() => landing),
    } as unknown as ChatViewport
    const reading = {
      pending: false, followingTail: false,
      pauseFollowing: vi.fn(), acceptNavigation, preservePosition: vi.fn(),
    } as unknown as ChatReading
    const navigation = new ChatNavigation(viewport, reading, input, vi.fn())

    navigation.navigateToTurn({
      turn: 7, prompt: 'loaded prompt', response: '',
      anchor: { kind: 'loaded', key: 'turn-7-anchor', seq },
    })

    expect(revealThrough).toHaveBeenCalledWith(7, seq)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(navigation.contentCommitted()).toBe(true)
    expect(acceptNavigation).toHaveBeenCalledWith(landing)
  })

  it('reveals a locally loaded target before Session.loadThrough even while its rail mark is unloaded', () => {
    const seq = SessionSeq(20)
    const revealThrough = vi.fn(() => true)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(async () => {})
    const input: ChatNavigationInput = {
      sessionId: 'session-1', firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough, revealThrough,
    }
    const landing = {} as ViewportLanding
    const acceptNavigation = vi.fn()
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(), stopPreserving: vi.fn(), preserve: vi.fn(() => null),
      scrollToTurn: vi.fn().mockReturnValueOnce(landing),
      scrollToTurnAtOrAfter: vi.fn(() => landing),
    } as unknown as ChatViewport
    const reading = {
      pending: false, followingTail: false,
      pauseFollowing: vi.fn(), acceptNavigation, preservePosition: vi.fn(),
    } as unknown as ChatReading
    const navigation = new ChatNavigation(viewport, reading, input, vi.fn())

    navigation.navigateToTurn({
      turn: 9, prompt: 'already loaded', response: '',
      anchor: { kind: 'unloaded', seq },
    })

    expect(revealThrough).toHaveBeenCalledWith(9, seq)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(navigation.contentCommitted()).toBe(true)
    expect(acceptNavigation).toHaveBeenCalledWith(landing)
  })

  it('does not request another page when the inclusive window begins at the target seq', async () => {
    const seq = SessionSeq(5)
    const page = Promise.resolve()
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const input: ChatNavigationInput = {
      sessionId: 'session-1', firstSeq: seq, hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough,
      revealThrough: vi.fn(() => false), revealTurn: vi.fn(() => false),
    }
    const landing = {} as ViewportLanding
    const scrollToTurnAtOrAfter = vi.fn(() => landing)
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(), stopPreserving: vi.fn(), preserve: vi.fn(() => null),
      scrollToTurn: vi.fn(() => null), scrollToTurnAtOrAfter,
    } as unknown as ChatViewport
    const reading = {
      pending: false, followingTail: false,
      pauseFollowing: vi.fn(), acceptNavigation: vi.fn(), preservePosition: vi.fn(),
    } as unknown as ChatReading
    const navigation = new ChatNavigation(viewport, reading, input, vi.fn())

    navigation.navigateToTurn({
      turn: 6, prompt: 'target prompt', response: '', anchor: { kind: 'unloaded', seq },
    })
    await page
    await Promise.resolve()

    expect(loadThrough).toHaveBeenCalledTimes(1)
    expect(loadThrough).toHaveBeenCalledWith(seq)
    expect(scrollToTurnAtOrAfter).toHaveBeenCalledWith(6)
  })

  it('ignores a page completion after its session owner resets navigation', async () => {
    let releasePage!: () => void
    const page = new Promise<void>((resolve) => { releasePage = resolve })
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const input: ChatNavigationInput = {
      sessionId: 'session-1', firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough,
      revealThrough: vi.fn(() => false), revealTurn: vi.fn(() => false),
    }
    const scrollToTurn = vi.fn(() => null)
    const scrollToTurnAtOrAfter = vi.fn(() => null)
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(), stopPreserving: vi.fn(), preserve: vi.fn(() => null),
      scrollToTurn, scrollToTurnAtOrAfter,
    } as unknown as ChatViewport
    const reading = {
      pending: false, followingTail: false,
      pauseFollowing: vi.fn(), acceptNavigation: vi.fn(), preservePosition: vi.fn(),
    } as unknown as ChatReading
    const onBusyTurn = vi.fn()
    const navigation = new ChatNavigation(viewport, reading, input, onBusyTurn)

    navigation.navigateToTurn({
      turn: 4, prompt: 'remote prompt', response: '',
      anchor: { kind: 'unloaded', seq: SessionSeq(3) },
    })
    navigation.reset()
    releasePage()
    await page

    expect(scrollToTurn).not.toHaveBeenCalled()
    expect(scrollToTurnAtOrAfter).not.toHaveBeenCalled()
    expect(onBusyTurn).toHaveBeenLastCalledWith(null)
  })
})

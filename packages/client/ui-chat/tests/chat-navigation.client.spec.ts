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
    const page = new Promise<void>(resolve => { releasePage = resolve })
    const revealTurn = vi.fn<(turn: number) => boolean>().mockReturnValueOnce(true).mockReturnValue(false)
    const loadThrough = vi.fn<ChatNavigationInput['loadThrough']>(() => page)
    const input: ChatNavigationInput = {
      firstSeq: SessionSeq(0), hasMore: true, loadingOlder: false,
      loadOlder: vi.fn(), loadThrough, revealTurn,
    }
    const landing = {} as ViewportLanding
    const viewport = {
      get preserving() { return true },
      beginPreserving: vi.fn(),
      stopPreserving: vi.fn(),
      preserve: vi.fn(() => null),
      scrollToTurn: vi.fn(() => null),
      scrollToTurnAtOrAfter: vi.fn(() => landing),
    } as unknown as ChatViewport
    const reading = {
      pending: false,
      followingTail: false,
      pauseFollowing: vi.fn(),
      acceptNavigation: vi.fn(),
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
    expect(revealTurn).toHaveBeenCalledTimes(1)

    // The reveal state commits without mounting the anchor; reconciliation must not stay stuck.
    expect(navigation.contentCommitted()).toBe(false)
    expect(revealTurn).toHaveBeenCalledTimes(2)
    releasePage()
    await page

    expect(viewport.scrollToTurnAtOrAfter).toHaveBeenCalledWith(1)
    expect(reading.acceptNavigation).toHaveBeenCalledWith(landing)
    expect(onBusyTurn).toHaveBeenLastCalledWith(null)
  })
})

/** Turn jumps and history-prepend anchoring, independent of DOM measurement. */
import { useLayoutEffect, useState } from 'react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatScrollPosition, ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnRailItem } from './turn-rail-items.ts'
import type { ChatReading, ReadingSample } from './use-chat-reading.ts'
import type { ChatViewport, ViewportLanding } from './use-chat-viewport.ts'

/** History availability and loading operations for the committed Chat window. */
export interface ChatNavigationInput extends Pick<ChatViewSlotProps, 'loadOlder' | 'loadThrough' | 'consumeOlder'> {
  readonly firstSeq: ChatNode['anchorSeq'] | null
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  readonly historyLoadStatus: SessionSnapshot['historyLoadStatus']
  readonly isOpen: boolean
  /** Reattempt local turn reveal after a Conversation history page commits. */
  readonly historyRevision?: number
  readonly beforeLoadOlder?: () => void
  readonly revealEarlier?: () => boolean
  /** Key-based fallback when no durable outline sequence is available. */
  readonly revealTurn?: (turn: number) => boolean
  /** Reveal a loaded Turn after matching its durable outline sequence. */
  readonly revealThrough?: (turn: number, seq: SessionSeq) => boolean
  /** Update the request's semantic anchor after reader movement. */
  readonly readerPositionChanged?: (position: ChatScrollPosition | null) => void
}

interface TurnJump {
  readonly turn: number
  readonly seq: SessionSeq
  phase: 'loading' | 'settled'
  landing: 'pending' | 'revealing' | 'landed' | 'interrupted'
  repageHead: ChatNavigationInput['firstSeq']
}

type HistoryIntent = 'none' | 'auto' | 'manual'

type NavigationViewport = Pick<ChatViewport,
  'preserving' | 'beginPreserving' | 'beginPaging' | 'stopPreserving' | 'preserve' | 'capturePosition'
  | 'scrollToTurn' | 'scrollToTurnAtOrAfter' | 'beginManualPaging' | 'historyConsumption'
  | 'beginHistoryPrepend' | 'cancelHistoryPrepend' | 'confirmHistoryStart'>
type NavigationReading = Pick<ChatReading,
  'pending' | 'followingTail' | 'pauseFollowing' | 'acceptNavigation' | 'preservePosition'>

/** Owns one replaceable turn jump and the anchor retained while history loads. */
export class ChatNavigation {
  private jump: TurnJump | null = null
  private localLanding: { readonly turn: number; readonly seq: SessionSeq | undefined } | null = null
  private settleFrame: number | null = null
  private historyFrame: number | null = null
  private historyIntent: HistoryIntent = 'none'
  private historyRequested = false

  constructor(
    private readonly viewport: NavigationViewport,
    private readonly reading: NavigationReading,
    private input: ChatNavigationInput,
    private readonly onBusyTurn: (turn: number | null) => void,
    private readonly onHistoryIntent: (intent: HistoryIntent) => void = () => {},
  ) {}

  /**
   * Adopt committed history availability without starting a request.
   * @param input - history state from the latest committed render.
   */
  setInput(input: ChatNavigationInput): void {
    this.input = input
    this.historyRequested = false
    if (!input.isOpen || input.historyLoadStatus === 'error' || !input.hasMore) this.setHistoryIntent('none')
  }

  /** Cancel navigation when opening a Chat view. */
  reset(): void {
    this.cancel()
  }

  /** Cancel local callbacks; late history completions cannot revive a task. */
  dispose(): void {
    this.clearTask()
    if (this.historyFrame !== null) cancelAnimationFrame(this.historyFrame)
    this.historyFrame = null
  }

  /** Release the jump, paging anchor, and busy indicator without cancelling shared history I/O. */
  cancel(): void {
    this.setHistoryIntent('none')
    this.clearTask()
    this.onBusyTurn(null)
  }

  /** Release a jump after reader input without cancelling an accepted history click. */
  readerInteracted(): void {
    this.clearTask()
    this.onBusyTurn(null)
  }

  private clearTask(): void {
    this.cancelFrame()
    this.jump = null
    this.localLanding = null
    this.viewport.stopPreserving()
    this.viewport.cancelHistoryPrepend()
  }

  /**
   * Replace the current jump with an explicit turn selection.
   * @param item - loaded anchor or unloaded turn to fetch before landing.
   */
  readonly navigateToTurn = (item: TurnRailItem): void => {
    this.cancel()
    if (item.anchor.kind === 'loaded') {
      const landing = this.viewport.scrollToTurn(item.turn)
      if (landing !== null) {
        this.reading.acceptNavigation(landing)
        if (this.input.loadingOlder) this.viewport.beginPreserving(landing.position)
        return
      }
    }
    this.viewport.beginPreserving()
    this.reading.pauseFollowing()
    const target = { turn: item.turn, seq: item.anchor.seq }
    this.localLanding = target
    this.onBusyTurn(item.turn)
    if (this.revealLocal(target)) return
    this.localLanding = null
    if (target.seq !== undefined) this.startRemoteJump(target.turn, target.seq)
    else this.finishWithoutSequence(target.turn)
  }

  /** Request and consume one page, retaining the click until success, exhaustion, or failure. */
  readonly loadEarlier = (): void => {
    this.cancel()
    this.setHistoryIntent('manual')
    this.reading.pauseFollowing()
    // A bounded render window may hide rows the Session already loaded: revealing
    // them is synchronous so the click never waits for a frame or the Host.
    if (this.input.revealEarlier?.() === true) return
    if (this.input.historyLoadStatus === 'error') {
      this.historyRequested = true
      this.input.beforeLoadOlder?.()
      this.input.loadOlder()
    } else this.requestHistoryCheck()
  }

  private setHistoryIntent(intent: HistoryIntent): void {
    if (intent === this.historyIntent) return
    this.historyIntent = intent
    this.onHistoryIntent(intent)
  }

  /** Coalesce event-driven checks; waiting never schedules its own next frame. */
  requestHistoryCheck(): void {
    if (!this.input.isOpen || this.input.historyLoadStatus === 'error') return
    if (this.historyIntent === 'none' && (this.input.historyLoadStatus !== 'idle'
      || !this.input.hasMore || this.reading.followingTail)) return
    if (this.historyFrame !== null || typeof requestAnimationFrame !== 'function') return
    this.historyFrame = requestAnimationFrame(() => {
      this.historyFrame = null
      this.checkHistory()
    })
  }

  private checkHistory(): void {
    const input = this.input
    if (!input.isOpen || this.jump !== null || this.historyRequested || input.loadingOlder) return
    if (input.historyLoadStatus === 'error') return
    if (input.historyLoadStatus === 'pendingConsumption') {
      if (this.historyIntent === 'none') return
      if (this.reading.followingTail && this.historyIntent === 'auto') {
        this.setHistoryIntent('none')
        return
      }
      if (this.historyIntent === 'manual') {
        this.viewport.beginManualPaging()
        this.reading.pauseFollowing()
        this.consumeHistory('preserve')
        return
      }
      const mode = this.viewport.historyConsumption()
      switch (mode) {
        case 'touch':
        case 'inner-scroll':
          return
        case 'motion':
        case 'pointer':
        case 'unavailable':
          this.setHistoryIntent('none')
          return
        case 'prepend':
          if (!this.viewport.beginHistoryPrepend() && input.firstSeq !== null) {
            this.setHistoryIntent('none')
            return
          }
          break
        case 'preserve':
        case 'native':
          break
      }
      if (mode === 'preserve') {
        this.viewport.beginPreserving()
        if (!this.viewport.preserving) this.viewport.beginPaging()
        if (!this.viewport.preserving && input.firstSeq !== null) {
          this.setHistoryIntent('none')
          return
        }
        this.reading.pauseFollowing()
      }
      this.consumeHistory(mode)
      return
    }
    // A bounded render window may hide rows the Session already loaded: reveal
    // those before asking the Host for another page.
    if (input.revealEarlier?.() === true) return
    if (!input.hasMore || this.historyIntent !== 'manual' && (this.reading.followingTail
      || !this.viewport.confirmHistoryStart())) return
    if (this.historyIntent === 'none') this.setHistoryIntent('auto')
    input.beforeLoadOlder?.()
    this.historyRequested = true
    input.loadOlder()
  }

  private consumeHistory(mode: 'native' | 'preserve' | 'prepend'): void {
    this.historyRequested = true
    if (this.input.consumeOlder()) this.setHistoryIntent('none')
    else {
      this.historyRequested = false
      if (mode === 'preserve') this.viewport.stopPreserving()
      if (mode === 'prepend') this.viewport.cancelHistoryPrepend()
    }
  }

  /**
   * Preserve reader ownership across pending history work.
   * @param sample - settled reader movement that can update or interrupt an anchor.
   */
  readerMoved(movedByReader: boolean): void {
    if (movedByReader && this.input.loadingOlder && this.viewport.preserving) {
      this.input.readerPositionChanged?.(this.viewport.capturePosition())
    }
  }

  readerSampled(sample: ReadingSample): void {
    if (sample.movedByReader && this.jump?.landing === 'landed') this.jump.landing = 'interrupted'
    if (sample.followingTail) {
      this.input.readerPositionChanged?.(null)
      this.viewport.stopPreserving()
      return
    }
    if (!sample.movedByReader) return
    this.input.readerPositionChanged?.(sample.position)
    if (this.input.loadingOlder && this.jump === null && sample.position !== null) {
      this.viewport.beginPreserving(sample.position)
    } else this.viewport.stopPreserving()
  }

  /**
   * Preserve one paging anchor after a commit or a later size change, regardless of head identity.
   * @returns whether the retained anchor handled the layout change.
   */
  contentCommitted(): boolean {
    if (this.reading.pending) return false
    if (this.localLanding !== null) {
      const target = this.localLanding
      const landing = this.viewport.scrollToTurn(target.turn)
      if (landing !== null) {
        this.localLanding = null
        this.onBusyTurn(null)
        this.reading.acceptNavigation(landing)
        this.retainLandingDuringHistory(landing)
        return true
      }
      if (this.revealLocal(target)) {
        const retained = this.viewport.preserve()
        if (retained !== null) this.reading.preservePosition(retained)
        return true
      }
      this.localLanding = null
      if (target.seq !== undefined) this.startRemoteJump(target.turn, target.seq)
      else this.finishWithoutSequence(target.turn)
      return true
    }
    const jump = this.jump
    if (jump?.landing === 'revealing') jump.landing = 'pending'
    if (this.landJump(false)) return true
    if (this.jump?.landing === 'revealing') {
      const retained = this.viewport.preserve()
      if (retained !== null) this.reading.preservePosition(retained)
      return true
    }
    if (!this.viewport.preserving) return false
    const landing = this.viewport.preserve()
    if (landing === null) return false
    this.reading.preservePosition(landing)
    return true
  }

  /** Land, retry, or complete the current jump against the committed window. */
  reconcile(): void {
    const jump = this.jump
    if (jump === null || this.reading.pending) return
    if (jump.phase === 'loading') {
      if (jump.landing === 'pending') this.landJump(false)
      return
    }
    if (this.input.loadingOlder) return
    if (this.landJump(true)) return
    if (jump.landing === 'revealing') return
    const uncovered = this.input.firstSeq === null || this.input.firstSeq > jump.seq
    if (uncovered && this.input.hasMore && jump.repageHead !== this.input.firstSeq) {
      jump.repageHead = this.input.firstSeq
      this.viewport.beginPreserving()
      this.request(jump)
      return
    }
    const fallback = this.viewport.scrollToTurnAtOrAfter(jump.turn)
    this.cancel()
    if (fallback !== null) this.reading.acceptNavigation(fallback)
  }

  private landJump(settle: boolean): boolean {
    const jump = this.jump
    if (jump === null) return false
    if (jump.landing === 'interrupted') {
      if (settle) { this.cancel(); return true }
      return false
    }
    const landing = this.viewport.scrollToTurn(jump.turn)
    if (landing === null) {
      if (this.input.revealThrough?.(jump.turn, jump.seq) === true
        || this.input.revealTurn?.(jump.turn) === true) {
        jump.landing = 'revealing'
        this.onBusyTurn(jump.turn)
      }
      return false
    }
    this.reading.acceptNavigation(landing)
    if (settle) this.cancel()
    else {
      this.viewport.beginPreserving(landing.position)
      jump.landing = 'landed'
    }
    return true
  }

  private revealLocal(target: { readonly turn: number; readonly seq: SessionSeq | undefined }): boolean {
    return (target.seq !== undefined
      && this.input.revealThrough?.(target.turn, target.seq) === true)
      || this.input.revealTurn?.(target.turn) === true
  }

  private startRemoteJump(turn: number, seq: SessionSeq): void {
    const jump: TurnJump = {
      turn, seq, phase: 'loading', landing: 'pending', repageHead: null,
    }
    this.jump = jump
    this.onBusyTurn(turn)
    this.request(jump)
  }

  private finishWithoutSequence(turn: number): void {
    const fallback = this.viewport.scrollToTurnAtOrAfter(turn)
    this.onBusyTurn(null)
    if (fallback !== null) {
      this.reading.acceptNavigation(fallback)
      this.retainLandingDuringHistory(fallback)
    } else this.viewport.stopPreserving()
  }

  private retainLandingDuringHistory(landing: ViewportLanding): void {
    if (this.input.loadingOlder) this.viewport.beginPreserving(landing.position)
    else this.viewport.stopPreserving()
  }

  private request(jump: TurnJump): void {
    jump.phase = 'loading'
    const settled = (): void => {
      if (this.jump !== jump) return
      jump.phase = 'settled'
      this.cancelFrame()
      if (typeof requestAnimationFrame !== 'function') this.reconcile()
      else this.settleFrame = requestAnimationFrame(() => {
        this.settleFrame = null
        if (this.jump === jump) this.reconcile()
      })
    }
    void this.input.loadThrough(jump.seq).then(settled, settled)
  }

  private cancelFrame(): void {
    if (this.settleFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.settleFrame)
    this.settleFrame = null
  }
}

/**
 * Retain one navigation owner for the component's lifetime.
 * @param viewport - turn-aware DOM operations.
 * @param reading - reading and follow policy receiving navigation landings.
 * @param input - committed history state and load operations.
 * @returns the navigation owner and its visible busy turn.
 */
export function useChatNavigation(
  viewport: ChatViewport, reading: ChatReading, input: ChatNavigationInput,
): { navigation: ChatNavigation; busyTurn: number | null; historyPending: boolean; historyProcessing: boolean } {
  const [busyTurn, setBusyTurn] = useState<number | null>(null)
  const [historyIntent, setHistoryIntent] = useState<HistoryIntent>('none')
  const [navigation] = useState(() => new ChatNavigation(viewport, reading, input, setBusyTurn, setHistoryIntent))
  useLayoutEffect(() => { navigation.setInput(input) }, [navigation, input])
  useLayoutEffect(() => () => { navigation.dispose() }, [navigation])
  return { navigation, busyTurn, historyPending: historyIntent === 'manual', historyProcessing: historyIntent !== 'none' }
}

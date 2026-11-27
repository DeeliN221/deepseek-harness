/** Composes viewport operations, reading policy, and history navigation for Chat. */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TranscriptViewMode } from '../../chat-settings.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import type { ChatScrollPosition, ChatViewSlotProps } from '../contract/slots.ts'
import { useChatNavigation, type ChatNavigation, type ChatNavigationInput } from './use-chat-navigation.ts'
import { useChatReading, type ChatReadingState } from './use-chat-reading.ts'
import { useChatViewport } from './use-chat-viewport.ts'
import type { FlowMotionRows } from './flow-motion.ts'

/** Committed content and Session operations used to reconcile scroll ownership. */
export interface ChatScrollInput extends ChatNavigationInput {
  /** Session whose saved reading position and navigation state this hook owns. */
  readonly sessionId: string
  readonly chatScroll: ChatViewSlotProps['chatScroll']
  readonly historyPagePending?: boolean
  readonly historyPagePosition?: ChatScrollPosition | null
  readonly historyPageCommitted?: boolean
  readonly historyPageInvalidated?: boolean
  readonly order: readonly string[]
  /** Rendered Chat suffix/slice; `order` remains the complete paging/navigation authority. */
  readonly renderOrder: readonly string[]
  readonly renderedGlobalTail: boolean
  readonly advanceRenderWindow: () => boolean
  readonly lastKey: string | null
  readonly lastIsUser: boolean
  readonly steeringId: string | null
  readonly submissionId: string | null
  /** The latest visible submission steers the running Turn instead of opening a new one. */
  readonly submissionSteers: boolean
  readonly running: boolean
  /** Enable the browser-local delayed-fold experiment and its input reveal animation. */
  readonly deferCompletedTurns: boolean
  /** A changed work-details preference resets fold reservations after the layout settles. */
  readonly transcriptView: TranscriptViewMode
  readonly loadedTurns: ReturnType<ChatSnapshot['navigation']['items']>
}

interface ChatScrollState extends ChatReadingState {
  readonly listRef: RefObject<HTMLDivElement>
  readonly columnRef: RefObject<HTMLDivElement>
  readonly busyTurn: number | null
  readonly navigateToTurn: ChatNavigation['navigateToTurn']
  readonly loadEarlier: ChatNavigation['loadEarlier']
  readonly historyInputHeld: boolean
  readonly historyProcessing: boolean
  readonly historyPending: boolean
  readonly historyEdgeRef: (element: HTMLDivElement | null) => void
  readonly returnToBottom: () => void
  readonly motion: FlowMotionRows
}

/**
 * Coordinate scroll policy after Chat content commits. Initial history must be available
 * before automatic scroll or resize handling can initialize reading state and fold motion.
 * New submitted input supersedes pending reader sampling.
 * @param input - current Chat content, scroll memory, and history operations.
 * @returns element refs, visible reading state, and navigation callbacks.
 */
export function useChatScroll(input: ChatScrollInput): ChatScrollState {
  const {
    sessionId, isOpen, order, renderOrder, renderedGlobalTail, advanceRenderWindow,
    firstSeq, lastKey, lastIsUser, steeringId, submissionId, submissionSteers, running,
    deferCompletedTurns, loadedTurns, chatScroll, hasMore, loadingOlder, historyLoadStatus, historyRevision,
    loadOlder, consumeOlder, loadThrough, beforeLoadOlder, historyPageStarted, beforeConsumeOlder,
    historyPagePending, historyPageCommitted, revealEarlier, revealTurn, revealThrough, transcriptView,
  } = input
  const { viewport, listRef, columnRef } = useChatViewport()
  const [historyInputHeld, setHistoryInputHeld] = useState(false)
  const { reading, state } = useChatReading(
    viewport, chatScroll, loadedTurns.at(-1)?.turn ?? null, renderedGlobalTail, advanceRenderWindow,
  )
  const navigationInput = useMemo(() => ({
    firstSeq, loadingOlder, hasMore, historyLoadStatus, isOpen, loadOlder, consumeOlder, loadThrough,
    ...(historyRevision === undefined ? {} : { historyRevision }),
    ...(beforeLoadOlder === undefined ? {} : { beforeLoadOlder }),
    ...(historyPageStarted === undefined ? {} : { historyPageStarted }),
    ...(beforeConsumeOlder === undefined ? {} : { beforeConsumeOlder }),
    ...(revealEarlier === undefined ? {} : { revealEarlier }),
    ...(revealTurn === undefined ? {} : { revealTurn }),
    ...(revealThrough === undefined ? {} : { revealThrough }),
    ...(input.readerPositionChanged === undefined ? {} : { readerPositionChanged: input.readerPositionChanged }),
  }), [firstSeq, loadingOlder, hasMore, historyLoadStatus, isOpen, loadOlder, consumeOlder, loadThrough,
    historyRevision, beforeLoadOlder, historyPageStarted, beforeConsumeOlder, revealEarlier, revealTurn, revealThrough, input.readerPositionChanged])
  const { navigation, busyTurn, historyPending, historyProcessing } = useChatNavigation(viewport, reading, navigationInput)
  const navigationSession = useRef(sessionId)
  useLayoutEffect(() => {
    if (navigationSession.current === sessionId) return
    navigationSession.current = sessionId
    navigation.reset()
    content.current.opened = false
    content.current.applied = null
  }, [navigation, sessionId])
  const content = useRef<{ input: ChatScrollInput; applied: ChatScrollInput | null; opened: boolean }>({
    input, applied: null, opened: false,
  })
  // A fold batch owns layout and scrolling until it lands: at the tail for own input or a following
  // reader, otherwise with the reader's content still. Growth consumes any room the landing installed.
  const cancelPendingFollow = useCallback(() => { viewport.motion.cancelInput() }, [viewport])

  const processContent = useCallback(() => {
    const current = content.current.input
    if (!current.isOpen && !content.current.opened) return
    const previous = content.current.applied
    const steeringInput = current.steeringId !== null && current.steeringId !== previous?.steeringId
      && current.steeringId !== previous?.submissionId
    const submissionInput = current.submissionId !== null && current.submissionId !== previous?.submissionId
      && current.submissionId !== previous?.steeringId
    const ownInput = (current.lastIsUser && current.lastKey !== previous?.lastKey) || steeringInput || submissionInput
    if (reading.pending && !ownInput) return
    content.current.applied = current
    if (current.isOpen && !content.current.opened) {
      content.current.opened = true
      navigation.reset()
      reading.restore()
      return
    }
    if (ownInput) {
      navigation.cancel()
      if (current.deferCompletedTurns && reading.followInputFold(true)) return
      // Steering lands at once: the running Turn keeps streaming above its echo, and that growth would push
      // the echo down under a native animation.
      const steering = steeringInput || (submissionInput && current.submissionSteers)
      reading.followTail(current.deferCompletedTurns && !steering ? 'smooth' : 'instant')
      return
    }
    if (navigation.contentCommitted()) {
      navigation.reconcile()
      return
    }
    const tipChanged = previous === null || current.isOpen !== previous.isOpen
      || current.firstSeq !== previous.firstSeq || current.lastKey !== previous.lastKey
      || current.order.length !== previous.order.length || current.renderOrder !== previous.renderOrder
      || current.running !== previous.running
      || current.steeringId !== previous.steeringId || current.submissionId !== previous.submissionId
    if (tipChanged && reading.followingTail) {
      navigation.cancel()
      if (current.deferCompletedTurns && reading.followInputFold(false)) return
      reading.followTail()
    } else navigation.reconcile()
  }, [reading, navigation])

  useLayoutEffect(() => {
    const disconnectViewport = viewport.connect({
      scroll: (event) => {
        if (!content.current.opened) return
        if (!event.movedByReader && viewport.motion.foldActive()) return
        navigation.readerMoved(event.movedByReader)
        reading.onScroll(event)
      },
      scrollEnd: (outer) => {
        reading.onScrollEnd(outer)
        navigation.requestHistoryCheck()
      },
      interact: () => { navigation.readerInteracted() },
      history: () => {
        setHistoryInputHeld(viewport.historyInputHeld)
        if (content.current.opened) navigation.requestHistoryCheck()
      },
      intent: () => { cancelPendingFollow(); reading.interruptFollow() },
      forward: () => { if (content.current.opened) reading.onForwardIntent() },
      resize: () => {
        if (!content.current.opened) return
        navigation.requestHistoryCheck()
        if (navigation.contentCommitted()) {
          navigation.reconcile()
          return
        }
        if (!content.current.input.deferCompletedTurns || !viewport.motion.foldActive()) reading.onResize()
        navigation.reconcile()
      },
    })
    const disconnectReading = reading.connect((sample) => {
      navigation.readerSampled(sample)
      processContent()
      navigation.requestHistoryCheck()
    })
    return () => {
      disconnectViewport()
      disconnectReading()
      content.current.opened = false
      content.current.applied = null
    }
  }, [viewport, reading, navigation, processContent, cancelPendingFollow])

  useLayoutEffect(() => {
    const previous = content.current.input
    content.current.input = {
      sessionId, order, renderOrder, renderedGlobalTail, advanceRenderWindow,
      lastKey, lastIsUser, steeringId, submissionId, submissionSteers, running, loadedTurns,
      chatScroll, deferCompletedTurns, transcriptView,
      ...(historyPagePending === undefined ? {} : { historyPagePending }),
      ...(historyPageCommitted === undefined ? {} : { historyPageCommitted }),
      ...(input.historyPagePosition === undefined ? {} : { historyPagePosition: input.historyPagePosition }),
      ...(input.historyPageInvalidated === undefined ? {} : { historyPageInvalidated: input.historyPageInvalidated }),
      ...navigationInput,
    }
    if (!deferCompletedTurns) {
      cancelPendingFollow()
      reading.interruptFollow()
    }
    viewport.updateTurns(loadedTurns)
    const protectHistoryPosition = () => {
      if (historyPagePending && !viewport.preserving && viewport.historyPosition() === null
        && input.historyPagePosition !== undefined && input.historyPagePosition !== null) {
        viewport.beginPreserving(input.historyPagePosition)
      }
    }
    protectHistoryPosition()
    const layoutChanged = previous.order !== order || previous.renderOrder !== renderOrder
      || previous.isOpen !== isOpen
    const historyConsumed = previous.historyLoadStatus === 'pendingConsumption' && historyLoadStatus === 'idle'
    if (!isOpen || historyLoadStatus === 'error' || (input.historyPagePending && input.historyPageInvalidated)) viewport.cancelHistoryPrepend()
    else if (historyPageCommitted || (!historyPagePending && (layoutChanged || historyConsumed))) {
      const landing = viewport.finishHistoryPrepend()
      if (landing !== null) reading.preservePosition(landing)
    }
    if (layoutChanged) viewport.invalidate()
    viewport.reclaimBelow()
    const opening = !content.current.opened
    processContent()
    if (opening) protectHistoryPosition()
    if (layoutChanged && content.current.opened) reading.refreshActiveTurn()
    if (content.current.opened) navigation.requestHistoryCheck()
  }, [
    viewport, reading, processContent, navigationInput, isOpen, order, renderOrder,
    renderedGlobalTail, advanceRenderWindow, lastKey, lastIsUser,
    steeringId, submissionId, submissionSteers, running, loadedTurns, chatScroll, deferCompletedTurns, transcriptView,
    cancelPendingFollow, historyPagePending, historyPageCommitted, input.historyPagePosition, input.historyPageInvalidated,
  ])

  const previousView = useRef(transcriptView)
  useLayoutEffect(() => {
    if (previousView.current === transcriptView) return
    previousView.current = transcriptView
    cancelPendingFollow()
    reading.interruptFollow()
    return viewport.motion.onFoldIdle(() => {
      viewport.resetBelow()
      if (content.current.opened) reading.onResize()
    })
  }, [transcriptView, viewport, reading, cancelPendingFollow])

  const returnToBottom = useCallback(() => {
    cancelPendingFollow()
    navigation.cancel()
    reading.followTail()
  }, [navigation, reading, cancelPendingFollow])

  return {
    listRef, columnRef, ...state, busyTurn, motion: viewport.motion,
    navigateToTurn: navigation.navigateToTurn,
    loadEarlier: navigation.loadEarlier,
    historyPending,
    historyProcessing,
    historyInputHeld,
    historyEdgeRef: viewport.setHistoryEdge,
    returnToBottom,
  }
}

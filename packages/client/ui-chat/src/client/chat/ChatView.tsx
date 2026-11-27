// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  GroupKey, NodeKey, RenderEntry,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import {
  Button, FenceCodeBlock, IconChevronDownOutlineRegular, MarkdownDelegateProvider, Modal,
  type MarkdownDelegateFenceInfo, type MarkdownMenuTarget,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isAtOrOutside } from '../contract/group-tree.ts'
import type { ChatFlowHookContext, ChatScrollPosition, ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { mergeTurnRailItems } from './turn-rail-items.ts'
import { useTextInteraction } from './text-interaction.ts'
import { useChatScroll } from './use-chat-scroll.ts'
import {
  CHAT_RENDER_WINDOW_NODES, anchoredRenderWindow, earlierRenderWindow, laterRenderWindow,
  renderWindowAnchor, resolveRenderWindow, savedAnchorIndex,
} from './render-window.ts'
import type { ChatRenderWindowAnchor } from './render-window.ts'
import { fileAddressFor, fileMediaUrl, resolveWorkspacePath, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import css from './ChatView.module.css'

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/**
 * Durable input identities suppress matching echoes in the same render.
 * The last input's Turn also distinguishes an empty opening control from
 * one whose human input or trigger notice is already present.
 */
function observedInputs(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
): { readonly rpcIds: ReadonlySet<string>; readonly lastInputTurn: number | undefined } {
  const observed = new Set<string>()
  let lastInputTurn: number | undefined
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || !isAtOrOutside(node, 'input')) continue
    if (node.location.kind === 'turn' || node.location.kind === 'step') lastInputTurn = node.location.turn.turn
    const data: unknown = node.data
    const source = typeof data === 'object' && data !== null && 'source' in data ? data.source : undefined
    if (typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'user'
      && 'rpcId' in source && typeof source.rpcId === 'string') observed.add(source.rpcId)
  }
  return { rpcIds: observed, lastInputTurn }
}

type PendingInput = PendingSubmission | InboxState['next-step'][number]

/** How long fold transitions stay enabled after a Turn stops running. */
const MOTION_TAIL_MS = 800

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useConversation, useSessions, renderSlot,
  sessionId, openFile, openExternalLink, resolveFilePath, useContextMenu, useResource,
  loadOlder, historyPageId: readHistoryPageId, historyPageState: readHistoryPageState,
  historyPageConsumed, consumeOlder, loadThrough, loadImage, inspectCall, chatScroll, forkAt,
  usePresentation, useProjection, useFilePathBase, useInteractionIds, dispatchInteraction, t, fileDrag,
}: ChatViewSlotProps) {
  const { getTriggerProps } = useContextMenu()
  const getMarkdownTriggerProps = useCallback((target: MarkdownMenuTarget) => getTriggerProps(() => {
    switch (target.kind) {
      case 'file': return { kind: 'file', value: { sessionId, path: resolveFilePath(target.path),
        ...(target.line === undefined ? {} : { line: target.line }) } }
      case 'url': return { kind: 'url', value: { sessionId, url: target.url } }
      case 'image': return { kind: 'image', value: { sessionId, url: target.url,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.mediaType === undefined ? {} : { mediaType: target.mediaType }),
        ...(target.path === undefined ? {} : { path: resolveFilePath(target.path) }) } }
    }
  }), [getTriggerProps, resolveFilePath, sessionId])
  const order = useChat(s => s.order)
  const groupedView = useConversation(snapshot => snapshot.views.grouped('chat'))
  const groupedEntries = useConversation(snapshot => snapshot.views.grouped('chat')?.entries)
  const historyWindow = useConversation(snapshot => snapshot.historyWindow)
  const historyRevision = useConversation(snapshot => snapshot.historyWindow?.revision ?? 0)
  const committedHistoryPages = useConversation(snapshot => snapshot.historyPageIds)
  const historyPageResult = useSession(snapshot => snapshot.historyPageResult)
  const historyPageResults = useSession(snapshot => snapshot.historyPageResults)
  const currentHistoryPage = useSession(snapshot => snapshot.historyPageId)
  const pendingRemoteAnchor = useRef<{ readonly sessionId: string; readonly key: string; readonly pageId?: number } | null>(null)
  const entries = useMemo<readonly RenderEntry[]>(() => groupedEntries
    ?? order.map(key => ({ kind: 'node', key: key as NodeKey })), [groupedEntries, order])
  const nodeStore = useChat(s => s.nodes)
  const [renderWindow, setRenderWindow] = useState<ChatRenderWindowAnchor | null>(null)
  const savedPosition = chatScroll.read()
  const localReader = useRef<{ sessionId: string; position: ChatScrollPosition | null }>({ sessionId, position: savedPosition })
  const sharedPage = readHistoryPageState?.()
  const observedSharedPage = useRef({ sessionId, pageId: sharedPage?.result === 'pending' ? undefined : sharedPage?.id })
  const [, retrySharedPage] = useState(0)
  const localChatScroll = useMemo(() => ({
    read: () => chatScroll.read(),
    save: (position: ChatScrollPosition | null) => {
      localReader.current = { sessionId, position }
      chatScroll.save(position)
      const page = readHistoryPageState?.()
      if (position !== null && pendingRemoteAnchor.current === null && page?.result === 'pending') {
        observedSharedPage.current = { sessionId, pageId: undefined }
        retrySharedPage(value => value + 1)
      }
    },
  }), [chatScroll, readHistoryPageState, sessionId])
  const readerAtRender = localReader.current
  const observedAtRender = observedSharedPage.current
  const pendingAtRender = pendingRemoteAnchor.current
  const readerForRender = readerAtRender.sessionId === sessionId
    ? readerAtRender : { sessionId, position: savedPosition }
  let observedForRender = observedAtRender.sessionId === sessionId
    ? observedAtRender : { sessionId, pageId: sharedPage?.result === 'pending' ? undefined : sharedPage?.id }
  let pendingPage = pendingAtRender?.sessionId === sessionId ? pendingAtRender : null
  if (sharedPage !== undefined && sharedPage.id !== observedForRender.pageId) {
    const position = readerForRender.position
    const priorResult = pendingPage?.pageId === undefined ? undefined : historyPageResults?.get(pendingPage.pageId)
    if (pendingPage?.pageId === sharedPage.id || sharedPage.result === 'invalidated' || sharedPage.result === 'error') {
      observedForRender = { sessionId, pageId: sharedPage.id }
    } else if ((pendingPage === null || priorResult === 'invalidated' || priorResult === 'error') && position !== null) {
      const key = position.windowAnchorKey ?? (position.anchorKey.startsWith('group:')
        ? renderWindow?.firstKey : position.anchorKey)
      if (key !== undefined) {
        pendingPage = { sessionId, key, pageId: sharedPage.id }
        observedForRender = { sessionId, pageId: sharedPage.id }
      }
    }
  }
  const savedAnchor = useRef<{ readonly sessionId: string; readonly key: string | null } | null>(null)
  const savedForRender = savedAnchor.current?.sessionId === sessionId ? savedAnchor.current
    : { sessionId, key: savedPosition?.windowAnchorKey ?? savedPosition?.anchorKey ?? null }
  useLayoutEffect(() => {
    // A reader event may have landed while React was preparing this render.
    if (readerAtRender.sessionId === sessionId && (localReader.current !== readerAtRender
      || observedSharedPage.current !== observedAtRender || pendingRemoteAnchor.current !== pendingAtRender)) {
      retrySharedPage(value => value + 1)
      return
    }
    localReader.current = readerForRender
    observedSharedPage.current = observedForRender
    pendingRemoteAnchor.current = pendingPage
    savedAnchor.current = savedForRender
  })
  const savedAnchorKey = savedForRender.key
  const savedWindow = useMemo(() => {
    if (order.length <= CHAT_RENDER_WINDOW_NODES || savedAnchorKey === null) return null
    const index = savedAnchorIndex(order, savedAnchorKey)
    if (index < 0) return null
    const bounds = anchoredRenderWindow(order.length, index, CHAT_RENDER_WINDOW_NODES,
      Math.floor(CHAT_RENDER_WINDOW_NODES / 3))
    return renderWindowAnchor(order, sessionId, bounds)
  }, [order, savedAnchorKey, sessionId])
  const pendingPageResult = pendingPage?.pageId === undefined ? undefined
    : historyPageResults?.get(pendingPage.pageId)
      ?? (pendingPage.pageId === currentHistoryPage ? historyPageResult : undefined)
  const historyPageCommitted = pendingPage !== null && pendingPage.sessionId === sessionId
    && pendingPage.pageId !== undefined && committedHistoryPages?.includes(pendingPage.pageId) === true
  const historyPageApplying = pendingPage !== null && pendingPage.sessionId === sessionId
    && pendingPage.pageId !== undefined && historyPageConsumed?.(pendingPage.pageId) === true
  const committedAnchorIndex = historyPageCommitted || historyPageApplying ? savedAnchorIndex(order, pendingPage!.key) : -1
  const committedWindow = committedAnchorIndex < 0 || order.length <= CHAT_RENDER_WINDOW_NODES ? null : renderWindowAnchor(order, sessionId,
    anchoredRenderWindow(order.length, committedAnchorIndex, CHAT_RENDER_WINDOW_NODES,
      Math.floor(CHAT_RENDER_WINDOW_NODES * 0.75)))
  const activeRenderWindow = committedWindow
    ?? (renderWindow?.sessionId === sessionId ? renderWindow : savedWindow ?? renderWindow)
  const renderBounds = useMemo(
    () => resolveRenderWindow(order, sessionId, activeRenderWindow), [activeRenderWindow, order, sessionId],
  )
  const renderOrder = useMemo(
    () => renderBounds.start === 0 && renderBounds.end === order.length
      ? order
      : order.slice(renderBounds.start, renderBounds.end),
    [order, renderBounds.end, renderBounds.start],
  )
  const visibleNodeKeys = useMemo(() => new Set(renderOrder), [renderOrder])
  const deferCompletedTurns = usePresentation(policy => policy.collapseTiming === 'next-input')
  const transcriptView = usePresentation(policy => policy.mode)
  // The rail's items are accumulated in the Chat snapshot, so this selector is
  // both the data and its change signal: the array identity moves only when a
  // Turn enters, leaves, or changes its preview.
  const turnNavigationItems = useChat(s => s.navigation.items())
  // Host-computed whole-log outline; the merge is view-layer only (the
  // conversation snapshot never carries projection values).
  const turnOutline = useProjection('turnOutline')
  const railItems = useMemo(
    () => mergeTurnRailItems(turnNavigationItems, turnOutline),
    [turnNavigationItems, turnOutline],
  )
  const inbox = useProjection('inbox') as InboxState | undefined
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const filePathBase = useFilePathBase(value => value)
  // The raw projection is only an invalidation token; the injected resolver
  // owns its interpretation and reads the same live path base as the opener.
  const fileResources = useMemo(() => ({
    useResource,
    address: (path: string) => fileAddressFor(sessionId, cwd, resolveFilePath(path)),
  }), [useResource, sessionId, cwd, resolveFilePath, filePathBase])
  const fileImages = useMemo(() => ({
    fileDrag,
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    resourceAddress: (path: string) => sessionFileAddress(sessionId, resolveWorkspacePath(cwd, path)),
    labels: {
      open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'),
      dialog: t('image.dialog'), close: t('image.close'),
    },
  }), [cwd, t, fileDrag, sessionId])
  const codeLabels = useMemo(() => markdownLabels(t).code, [t])
  // Every fence in the flow dispatches by language; the content is the plain
  // code block, so a language without a layer renders as code without diff rows.
  const renderCode = useCallback((fence: MarkdownDelegateFenceInfo) => renderSlot('conversation.chat.markdown.fence', fence, {
    entryKey: fence.lang,
    children: (
      <FenceCodeBlock lang={fence.lang} code={fence.code} streaming={fence.streaming} labels={codeLabels} diff={false} />
    ),
  }), [renderSlot, codeLabels])
  const running = useSession(s => s.running)
  // Fold transitions run while a Turn is live, while an input is pending, and briefly after settling.
  const [motionTail, setMotionTail] = useState(false)
  useEffect(() => {
    if (!deferCompletedTurns) {
      setMotionTail(false)
      return
    }
    if (running) {
      setMotionTail(true)
      return
    }
    const timer = setTimeout(() => { setMotionTail(false) }, MOTION_TAIL_MS)
    return () => { clearTimeout(timer) }
  }, [running, deferCompletedTurns])
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const historyLoadStatus = useSession(s => s.historyLoadStatus)
  const historyWasPartial = useSession(s => s.historyWasPartial)
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string, options?: OpenFileOptions) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void (options === undefined ? openFile(path) : openFile(path, options)).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t('fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const inboxSteering = useMemo(
    () => inbox?.['next-step'].filter(message => message.source.kind === 'user') ?? [],
    [inbox],
  )
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // Submission echoes still awaiting their durable counterpart. `order` is the
  // recompute trigger: durable user material always arrives as an append, and
  // every append replaces the order array.
  const [visibleSubmissions, lastInputTurn] = useMemo(() => {
    if (pendingSubmissions.length === 0) return [pendingSubmissions, undefined] as const
    const observed = observedInputs(order, nodeStore)
    return [pendingSubmissions.filter(submission => (
      submission.placement !== 'queued' && !observed.rpcIds.has(submission.requestId)
    )), observed.lastInputTurn] as const
  }, [pendingSubmissions, order, nodeStore])
  const pendingInputs = useMemo(() => {
    const local = new Map(visibleSubmissions.map(submission => [submission.requestId, submission]))
    // Admitted local identities outlive their bubbles until the Inbox claim watermark.
    const localIds = new Set(pendingSubmissions.filter(submission => submission.placement !== 'queued')
      .map(submission => submission.requestId))
    const pending = inboxSteering.flatMap<PendingInput>((item) => {
      const source = item.source
      if (source.kind !== 'user' || !('rpcId' in source)) return [item]
      const submission = local.get(source.rpcId)
      if (submission === undefined) return localIds.has(source.rpcId) ? [] : [item]
      local.delete(source.rpcId)
      return [submission]
    })
    return [...pending, ...local.values()]
  }, [inboxSteering, pendingSubmissions, visibleSubmissions])
  const deferCollapse = deferCompletedTurns
    && !pendingInputs.some(item => 'requestId' in item && item.placement === 'transcript')

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const renderControlState = useRef({
    order, renderBounds, renderOrder, groupedView, sessionId, turnNavigationItems, railItems, historyWindow, historyRevision,
  })
  useLayoutEffect(() => {
    renderControlState.current = {
      order, renderBounds, renderOrder, groupedView, sessionId, turnNavigationItems, railItems, historyWindow, historyRevision,
    }
  })
  const revealEarlier = useCallback((): boolean => {
    const { order: currentOrder, renderBounds: currentBounds, sessionId: currentSession,
      historyWindow: currentHistoryWindow } = renderControlState.current
    const next = earlierRenderWindow(currentOrder.length, currentBounds)
    if (next !== null) {
      const anchor = renderWindowAnchor(currentOrder, currentSession, next)
      if (anchor !== null) {
        setRenderWindow(anchor)
        return true
      }
    }
    return currentHistoryWindow?.expandOlder() ?? false
  }, [])
  const revealTurn = useCallback((turn: number): boolean => {
    const { order: currentOrder, renderBounds: currentBounds, sessionId: currentSession,
      turnNavigationItems: currentTurns } = renderControlState.current
    const target = currentTurns.find(item => item.turn === turn)
    if (target === undefined) return false
    const index = currentOrder.indexOf(target.anchorKey)
    if (index < 0 || (index >= currentBounds.start && index < currentBounds.end)) return false
    const next = anchoredRenderWindow(currentOrder.length, index, CHAT_RENDER_WINDOW_NODES,
      Math.floor(CHAT_RENDER_WINDOW_NODES / 3))
    const anchor = renderWindowAnchor(currentOrder, currentSession, next)
    if (anchor === null) return false
    setRenderWindow(anchor)
    return true
  }, [])
  const revealThrough = useCallback((turn: number, seq: SessionSeq): boolean => {
    const { order: currentOrder, renderBounds: currentBounds, sessionId: currentSession,
      railItems: currentRailItems, historyWindow: currentHistoryWindow } = renderControlState.current
    const target = currentRailItems.find(item => item.turn === turn)
    if (target === undefined || target.anchor.seq !== seq) return false
    if (target.anchor.kind === 'loaded') {
      const index = currentOrder.indexOf(target.anchor.key)
      if (index >= currentBounds.start && index < currentBounds.end) return false
      if (index >= 0) {
        const next = anchoredRenderWindow(currentOrder.length, index, CHAT_RENDER_WINDOW_NODES,
          Math.floor(CHAT_RENDER_WINDOW_NODES / 3))
        const anchor = renderWindowAnchor(currentOrder, currentSession, next)
        if (anchor !== null) {
          setRenderWindow(anchor)
          return true
        }
      }
    }
    return currentHistoryWindow?.revealThrough(turn, seq) ?? false
  }, [])
  const beforeLoadOlder = useCallback(() => {
    const { renderOrder: currentRenderOrder, sessionId: currentSession } = renderControlState.current
    const key = currentRenderOrder[0]
    if (key !== undefined) pendingRemoteAnchor.current = { sessionId: currentSession, key }
  }, [])
  const readerPositionChanged = useCallback((position: ChatScrollPosition | null) => {
    localReader.current = { sessionId, position }
    const pending = pendingRemoteAnchor.current
    if (pending === null) return
    if (pending.sessionId !== sessionId || position === null) {
      pendingRemoteAnchor.current = null
      return
    }
    let key = position.windowAnchorKey ?? position.anchorKey
    if (key.startsWith('group:')) {
      const { groupedView: view, renderOrder: mounted } = renderControlState.current
      const members = view?.groupSource(key.slice('group:'.length) as GroupKey).getSnapshot()?.members
      const memberKeys = new Set(members?.map(member => member.key) ?? [])
      // The group identity can name a member far outside the mounted slice.
      const mountedMember = mounted.find(nodeKey => memberKeys.has(nodeKey as NodeKey))
      if (mountedMember === undefined) return
      key = mountedMember
    }
    pendingRemoteAnchor.current = { ...pending, key }
  }, [sessionId])
  const historyPageStarted = useCallback(() => {
    const pending = pendingRemoteAnchor.current
    const pageId = readHistoryPageId?.()
    if (pending !== null && pending.sessionId === sessionId && pageId !== undefined) {
      pendingRemoteAnchor.current = { ...pending, pageId }
    }
  }, [readHistoryPageId, sessionId])
  const beforeConsumeOlder = useCallback((position: ChatScrollPosition | null) => {
    const pageId = readHistoryPageId?.()
    if (pageId === undefined) return
    const pending = pendingRemoteAnchor.current
    if (pending?.sessionId !== sessionId || pending.pageId !== pageId) {
      beforeLoadOlder()
      historyPageStarted()
    }
    if (position !== null) readerPositionChanged(position)
  }, [beforeLoadOlder, historyPageStarted, readHistoryPageId, readerPositionChanged, sessionId])
  const advanceRenderWindow = useCallback((): boolean => {
    const { order: currentOrder, renderBounds: currentBounds, sessionId: currentSession } = renderControlState.current
    const next = laterRenderWindow(currentOrder.length, currentBounds)
    if (next === null) return false
    const anchor = renderWindowAnchor(currentOrder, currentSession, next)
    if (anchor === null) return false
    setRenderWindow(anchor)
    return true
  }, [])
  const hasMoreForUi = hasMore || historyWindow?.pending === true || renderBounds.start > 0
  const lastKey = order.at(-1) ?? null
  const latestSteering = pendingInputs.findLast(item => 'source' in item)
  const steeringId = latestSteering?.source.kind === 'user' && 'rpcId' in latestSteering.source
    ? latestSteering.source.rpcId : latestSteering?.id ?? null
  const waitingForSavedAnchor = savedPosition !== null && order.length === 0
  const scroll = useChatScroll({
    isOpen: openState === 'open' && !waitingForSavedAnchor,
    sessionId,
    order, renderOrder, firstSeq, lastKey, running, loadingOlder, historyLoadStatus, hasMore, historyRevision,
    chatScroll: localChatScroll, loadOlder, consumeOlder, loadThrough,
    revealEarlier, revealTurn, revealThrough, beforeLoadOlder, historyPageStarted, beforeConsumeOlder,
    readerPositionChanged, deferCompletedTurns,
    historyPagePending: pendingPage?.sessionId === sessionId && pendingPage.pageId !== undefined,
    historyPagePosition: readerForRender.position,
    historyPageCommitted,
    historyPageInvalidated: pendingPageResult === 'invalidated' || pendingPageResult === 'error',
    renderedGlobalTail: renderBounds.end === order.length,
    advanceRenderWindow,
    lastIsUser: lastKey !== null && nodeStore.get(lastKey)?.kind === 'user',
    steeringId,
    submissionId: visibleSubmissions.at(-1)?.requestId ?? null,
    submissionSteers: visibleSubmissions.at(-1)?.placement === 'steering',
    loadedTurns: turnNavigationItems,
    transcriptView,
  })
  const returnToBottom = useCallback(() => {
    if (savedAnchor.current?.sessionId === sessionId) savedAnchor.current = { sessionId, key: null }
    setRenderWindow(null)
    scroll.returnToBottom()
  }, [scroll.returnToBottom, sessionId])
  const previousHistory = useRef({ sessionId })
  useLayoutEffect(() => {
    const previous = previousHistory.current
    let rangeUpdated = false
    if (previous.sessionId !== sessionId) {
      if (pendingRemoteAnchor.current?.sessionId !== sessionId) pendingRemoteAnchor.current = null
      setRenderWindow(null)
      rangeUpdated = true
    } else if (historyPageCommitted) {
      if (committedWindow !== null) {
        setRenderWindow(committedWindow)
        rangeUpdated = true
      }
      pendingRemoteAnchor.current = null
      if (sharedPage !== undefined && sharedPage.id !== pendingPage?.pageId
        && sharedPage.id !== observedSharedPage.current.pageId) retrySharedPage(value => value + 1)
    } else if (pendingPageResult === 'error' || pendingPageResult === 'invalidated') {
      pendingRemoteAnchor.current = null
      if (sharedPage !== undefined && sharedPage.id !== pendingPage?.pageId
        && sharedPage.id !== observedSharedPage.current.pageId) retrySharedPage(value => value + 1)
    }
    previousHistory.current = { sessionId }

    if (rangeUpdated || openState !== 'open') return
    if (scroll.followingTail) {
      if (renderWindow !== null && renderWindow.sessionId === sessionId) setRenderWindow(null)
    } else if ((renderWindow === null || renderWindow.sessionId !== sessionId) && renderOrder.length > 0) {
      setRenderWindow(renderWindowAnchor(order, sessionId, renderBounds))
    }
  }, [
    committedWindow, historyPageCommitted, pendingPage, pendingPageResult, sharedPage?.id,
    openState, order, renderBounds,
    renderOrder.length, renderWindow, scroll.followingTail, sessionId,
  ])
  const interactionSurfaceRef = useRef<HTMLDivElement>(null)
  const interactionIds = useInteractionIds(ids => ids)
  const textInteraction = useTextInteraction(scroll.columnRef, interactionSurfaceRef, dispatchInteraction, interactionIds)
  const flowContext = useMemo<ChatFlowHookContext>(() => ({ motion: scroll.motion }), [scroll.motion])

  return (
    <div className={css.frame}>
      {scroll.initialized && (
        <TurnNavigator
          items={railItems}
          activeTurn={scroll.activeTurn}
          busyTurn={scroll.busyTurn}
          onNavigate={scroll.navigateToTurn}
          t={t}
        />
      )}
      <div className={css.root} data-chat-following-tail={scroll.followingTail ? '' : undefined}>
        <div ref={scroll.listRef} className={css.scroll}>
          <div ref={scroll.columnRef} className={css.column} data-chat-flow=""
            data-chat-motion={deferCompletedTurns && scroll.initialized
              && (running || motionTail || pendingInputs.length > 0) ? '' : undefined}>
            {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
            {openState === 'error' && openError !== null && (
              <div className={css.openError}>
                {t('chat.loadError', { message: openError.message, code: openError.code })}
              </div>
            )}
            {(hasMoreForUi || historyWasPartial) && (
              <div className={css.older} ref={scroll.historyEdgeRef} data-chat-history={historyLoadStatus}>
                <button type="button" disabled={!hasMoreForUi}
                  onClick={scroll.loadEarlier}>
                  {([
                    ['more', t('chat.loadOlder')],
                    ['loading', t('chat.loadingOlder')],
                    ['processing', t('chat.processingOlder')],
                    ['error', t('chat.retryOlder')],
                    ['start', t('chat.historyStart')],
                  ] as const).map(([state, label]) => {
                    const current = !hasMoreForUi ? 'start' : loadingOlder ? 'loading'
                      : historyLoadStatus === 'error' ? 'error'
                        : scroll.historyInputHeld ? 'more'
                          : scroll.historyProcessing ? 'processing' : 'more'
                    return <span key={state} aria-hidden={state !== current}
                      className={state === current ? undefined : css.historyHidden}>{label}</span>
                  })}
                </button>
              </div>
            )}
            <MarkdownDelegateProvider
              getTriggerProps={getMarkdownTriggerProps}
              openFile={requestOpenFile}
              openExternalLink={openExternalLink}
              fileImages={fileImages}
              fileResources={fileResources}
              renderCode={renderCode}
            >
              {renderSlot('conversation.chat.flow', {
                entries, visibleOrder: renderOrder, visibleNodeKeys, pendingInputs, lastInputTurn, deferCollapse,
                cwd, openFile: requestOpenFile, inspectCall, forkAt, loadImage,
              }, { hookContext: flowContext })}
            </MarkdownDelegateProvider>
            <div ref={interactionSurfaceRef} className={css.textInteraction} data-text-interaction-surface=""
              aria-hidden={textInteraction.active === null}>
              {textInteraction.active !== null && renderSlot('conversation.chat.text-interaction', {
                trigger: textInteraction.active.trigger, readText: textInteraction.readText,
                dismiss: textInteraction.dismiss, clearSelection: textInteraction.clearSelection,
              }, { entryKey: textInteraction.active.id })}
            </div>
            {/* No pending placeholders: questions (ui-user-questions) and approvals
                (ApprovalPanel) both take over the composer, so a flow card would
                double-render the same wait. */}
          </div>
          {/* Fold room is reclaimed by viewport scroll, content-growth, and display-mode policies. */}
          <div className={css.turnSpacer} data-chat-turn-spacer aria-hidden="true" />
        </div>
      </div>
      {!scroll.followingTail && (
        <div className={css.toBottomSlot}>
          <button
            type="button"
            className={css.toBottom}
            aria-label={t('chat.toBottom')}
            onClick={returnToBottom}
          >
            <IconChevronDownOutlineRegular />
          </button>
        </div>
      )}
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  message, busy, onClose, onRetry, t,
}: {
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}

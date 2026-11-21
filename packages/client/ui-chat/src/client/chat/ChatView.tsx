// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  NodeKey, RenderEntry,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import {
  Button, IconChevronDownOutlineRegular, MarkdownDelegateProvider, Modal, type MarkdownMenuTarget,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isAtOrOutside } from '../contract/group-tree.ts'
import type { ChatFlowHookContext, ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { mergeTurnRailItems } from './turn-rail-items.ts'
import { useTextInteraction } from './text-interaction.ts'
import { useChatScroll } from './use-chat-scroll.ts'
import {
  CHAT_RENDER_WINDOW_NODES, anchoredRenderWindow, earlierRenderWindow, renderWindowAnchor, resolveRenderWindow,
} from './render-window.ts'
import type { ChatRenderWindowAnchor } from './render-window.ts'
import { fileMediaUrl, resolveWorkspacePath, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
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
  sessionId, openFile, openExternalLink, resolveFilePath, useContextMenu,
  loadOlder, loadThrough, loadImage, inspectCall, chatScroll, forkAt,
  usePresentation, useProjection, useInteractionIds, dispatchInteraction, t, fileDrag,
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
  const groupedEntries = useConversation(snapshot => snapshot.views.grouped('chat')?.entries)
  const entries = useMemo<readonly RenderEntry[]>(() => groupedEntries
    ?? order.map(key => ({ kind: 'node', key: key as NodeKey })), [groupedEntries, order])
  const nodeStore = useChat(s => s.nodes)
  const [renderWindow, setRenderWindow] = useState<ChatRenderWindowAnchor | null>(null)
  const renderBounds = useMemo(
    () => resolveRenderWindow(order, sessionId, renderWindow), [order, renderWindow, sessionId],
  )
  const renderOrder = useMemo(
    () => renderBounds.start === 0 && renderBounds.end === order.length
      ? order
      : order.slice(renderBounds.start, renderBounds.end),
    [order, renderBounds.end, renderBounds.start],
  )
  const visibleNodeKeys = useMemo(() => new Set(renderOrder), [renderOrder])
  const pendingRemoteAnchor = useRef<{ readonly sessionId: string; readonly key: string } | null>(null)
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
  const fileImages = useMemo(() => ({
    fileDrag,
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    resourceAddress: (path: string) => sessionFileAddress(sessionId, resolveWorkspacePath(cwd, path)),
    labels: {
      open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'),
      dialog: t('image.dialog'), close: t('image.close'),
    },
  }), [cwd, t, fileDrag, sessionId])
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
  const renderControlState = useRef({ order, renderBounds, renderOrder, sessionId, turnNavigationItems, railItems })
  renderControlState.current = { order, renderBounds, renderOrder, sessionId, turnNavigationItems, railItems }
  const revealEarlier = useCallback((): boolean => {
    const { order: currentOrder, renderBounds: currentBounds, sessionId: currentSession } = renderControlState.current
    const next = earlierRenderWindow(currentOrder.length, currentBounds)
    if (next === null) return false
    const anchor = renderWindowAnchor(currentOrder, currentSession, next)
    if (anchor === null) return false
    setRenderWindow(anchor)
    return true
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
      railItems: currentRailItems } = renderControlState.current
    const target = currentRailItems.find(item => item.turn === turn)
    if (target === undefined || target.anchor.kind !== 'loaded' || target.anchor.seq !== seq) return false
    const index = currentOrder.indexOf(target.anchor.key)
    if (index < 0 || (index >= currentBounds.start && index < currentBounds.end)) return false
    const next = anchoredRenderWindow(currentOrder.length, index, CHAT_RENDER_WINDOW_NODES,
      Math.floor(CHAT_RENDER_WINDOW_NODES / 3))
    const anchor = renderWindowAnchor(currentOrder, currentSession, next)
    if (anchor === null) return false
    setRenderWindow(anchor)
    return true
  }, [])
  const beforeLoadOlder = useCallback(() => {
    const { renderOrder: currentRenderOrder, sessionId: currentSession } = renderControlState.current
    const key = currentRenderOrder[0]
    if (key !== undefined) pendingRemoteAnchor.current = { sessionId: currentSession, key }
  }, [])
  const hasMoreForUi = hasMore || renderBounds.start > 0
  const lastKey = order.at(-1) ?? null
  const latestSteering = pendingInputs.findLast(item => 'source' in item)
  const steeringId = latestSteering?.source.kind === 'user' && 'rpcId' in latestSteering.source
    ? latestSteering.source.rpcId : latestSteering?.id ?? null
  const scroll = useChatScroll({
    sessionId,
    ready: openState === 'open',
    order, renderOrder, firstSeq, lastKey, running, loadingOlder, hasMore, loadOlder, loadThrough,
    revealEarlier, revealTurn, revealThrough, beforeLoadOlder, chatScroll, deferCompletedTurns,
    lastIsUser: lastKey !== null && nodeStore.get(lastKey)?.kind === 'user',
    steeringId,
    submissionId: visibleSubmissions.at(-1)?.requestId ?? null,
    submissionSteers: visibleSubmissions.at(-1)?.placement === 'steering',
    loadedTurns: turnNavigationItems,
    transcriptView,
  })
  const previousHistory = useRef({ sessionId, firstSeq, loadingOlder })
  useLayoutEffect(() => {
    const previous = previousHistory.current
    let rangeUpdated = false
    if (previous.sessionId !== sessionId) {
      pendingRemoteAnchor.current = null
      setRenderWindow(null)
      rangeUpdated = true
    } else {
      const pending = pendingRemoteAnchor.current
      if (pending !== null && pending.sessionId !== sessionId) {
        pendingRemoteAnchor.current = null
      } else if (pending !== null && firstSeq !== previous.firstSeq) {
        const index = order.indexOf(pending.key)
        if (index >= 0) {
          const next = anchoredRenderWindow(order.length, index, CHAT_RENDER_WINDOW_NODES,
            Math.floor(CHAT_RENDER_WINDOW_NODES * 0.75))
          if (next.start > 0 || next.end < order.length) {
            setRenderWindow(renderWindowAnchor(order, sessionId, next))
            rangeUpdated = true
          }
        }
        pendingRemoteAnchor.current = null
      } else if (pending !== null && previous.loadingOlder && !loadingOlder) {
        pendingRemoteAnchor.current = null
      }
    }
    previousHistory.current = { sessionId, firstSeq, loadingOlder }

    if (rangeUpdated || openState !== 'open') return
    if (scroll.followingTail) {
      if (renderWindow !== null && renderWindow.sessionId === sessionId) setRenderWindow(null)
    } else if ((renderWindow === null || renderWindow.sessionId !== sessionId) && renderOrder.length > 0) {
      setRenderWindow(renderWindowAnchor(order, sessionId, renderBounds))
    }
  }, [
    firstSeq, loadingOlder, openState, order, renderBounds, renderOrder.length, renderWindow,
    scroll.followingTail, sessionId,
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
            {hasMoreForUi && (
              <div className={css.older}>
                <button type="button" disabled={loadingOlder} onClick={scroll.loadEarlier}>
                  {loadingOlder ? t('loading') : t('chat.loadOlder')}
                </button>
              </div>
            )}
            <MarkdownDelegateProvider
              getTriggerProps={getMarkdownTriggerProps}
              openFile={requestOpenFile}
              openExternalLink={openExternalLink}
              fileImages={fileImages}
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
            onClick={scroll.returnToBottom}
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

/** Ordered Chat rows and local echoes share the flow slot's parent. */
import { memo, type ReactElement } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'

/** A local submission echo, or a Host-pending steering item without a local submission. */
type PendingInput = ChatFlowSlotProps['pendingInputs'][number]

/** Whether the echo is a local submission rather than a Host-pending steering item. */
function isLocalSubmission(item: PendingInput): item is PendingSubmission {
  return 'requestId' in item
}

/** Whether the echo is a local submission that opens a new Turn. */
function isTranscriptEcho(item: PendingInput): boolean {
  return isLocalSubmission(item) && item.placement === 'transcript'
}

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, visibleNodeKeys, pendingInputs, lastInputTurn, deferCollapse,
  useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, loadImage,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, inspectCall, forkAt, loadImage,
  }
  let visibleEntries = entries
  if (visibleNodeKeys !== undefined) {
    const visibleTurns = new Set<number>()
    for (const key of visibleNodeKeys) {
      const location = nodeStore.get(key)?.location
      if (location?.kind === 'turn' || location?.kind === 'step') visibleTurns.add(location.turn.turn)
    }
    visibleEntries = entries.filter((entry) => {
      if (entry.kind === 'group' || visibleNodeKeys.has(entry.key)) return true
      const node = nodeStore.get(entry.key)
      const location = node?.location
      // Turn process controls sit outside the ordered Chat node list, but remain structural rows
      // for any Turn represented in the bounded projection.
      return node?.kind === 'turn-process'
        && location?.kind === 'turn'
        && visibleTurns.has(location.turn.turn)
    })
  }
  const rows = visibleEntries.map((entry) => {
    switch (entry.kind) {
      case 'node':
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          {...visibleNodeKeys === undefined ? {} : { visibleNodeKeys }}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} />
      default:
        return assertNever(entry)
    }
  })
  // Transcript echoes open the next Turn before steering and Inbox echoes.
  // The first transcript echo opens the next Turn, whose first claim takes the
  // steering already pending ahead of it before that prompt; those echoes lead
  // the same Turn in claim order.
  const firstTranscript = pendingInputs.findIndex(isTranscriptEcho)
  const leadingRows: ReactElement[] = []
  const openingRows: ReactElement[] = []
  const pendingRows: ReactElement[] = []
  for (const [index, item] of pendingInputs.entries()) {
    const row = isLocalSubmission(item)
      ? <PendingSubmissionBubble key={item.requestId} submission={item}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
      : <PendingSteeringBubble key={item.id} content={item.content}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
    if (index <= firstTranscript) leadingRows.push(row)
    else if (isTranscriptEcho(item)) openingRows.push(row)
    else pendingRows.push(row)
  }
  const tail = visibleEntries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows the echoes that lead its Turn.
  // All rows share this keyed list so inserting the control keeps the echoes mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    rows.splice(rows.length - 1, 0, ...leadingRows.splice(0))
  }
  return [...rows, ...leadingRows, ...openingRows, ...pendingRows]
})

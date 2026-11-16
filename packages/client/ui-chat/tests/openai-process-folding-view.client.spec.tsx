// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { contextMenuHook, allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionEventLikeEntry, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
  inspectRequestPrompt,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq, type SessionEvent, type SessionEventMap, type SessionId } from '@deepseek-ai/dsh-session/types'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { inspectSystemPrompt } from '../../ui-conversation/src/client/contract/system-prompt.ts'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition, nextTurnInboxDefinition } from '../src/client/conversation-nodes/inbox.ts'
import { developerMessageDefinition, messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { requestPromptDefinition, systemMessageDefinition } from '../src/client/conversation-nodes/request-prompt.ts'
import { retryDefinition } from '../src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../src/client/conversation-nodes/turn-max-tokens.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import { processEvidenceDefinition, turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'
import { createChatStore } from '../src/client/stores.ts'
import { derivePresentationPolicy, type CollapseTiming, type FoldedReplies, type TranscriptViewMode } from '../src/client/presentation-policy.ts'
import { en } from '../src/client/locale.ts'
import { ChatNodeSeat } from '../src/client/chat/ChatNodeSeat.tsx'
import { TurnProcessNodeView } from '../src/client/chat/TurnProcessNodeView.tsx'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { CHAT_NODE_INJECT } from '../src/client/apply.ts'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatFlowSlotProps, ChatNodeHookContext, ChatNodeOwnerProps } from '../src/client/contract/slots.ts'
import { renderReasoningSlot } from './reasoning-component-fixture.tsx'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  nextStepInboxDefinition,
  nextTurnInboxDefinition,
  messageDefinition,
  developerMessageDefinition,
  systemMessageDefinition(inspectSystemPrompt),
  requestPromptDefinition(inspectRequestPrompt),
  assistantDefinition,
  turnProcessDefinition,
  processEvidenceDefinition,
  toolDefinition,
  commandDefinition,
  compactionDefinition,
  retryDefinition,
  turnErrorDefinition,
  turnMaxTokensDefinition,
  turnTailDefinition,
]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return DEFINITIONS }
  fallbackEntry(): ConversationNodeDefinition { return unknownFallbackDefinition }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

function at<Type extends keyof SessionEventMap>(
  seq: number,
  type: Type,
  data: SessionEventMap[Type],
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: { seq: SessionSeq(seq), time: 1_700_000_000_000 + seq * 100, type, data, ...extra } as SessionEvent,
  }
}

function userEvent(seq: number, turn: number, text: string): SessionLiveEventEntry {
  return at(seq, 'user/message', {
    turn,
    step: 1,
    message: { id: MessageId(`u-${seq}`), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  })
}

function assistantEvent(
  seq: number,
  turn: number,
  step: number,
  content: readonly ContentBlock[],
  source: SessionEventMap['assistant/message']['message']['source'] = { kind: 'model', provider: 'openai', model: 'gpt-5' },
): SessionLiveEventEntry {
  return at(seq, 'assistant/message', {
    turn,
    step,
    message: { id: MessageId(`a-${seq}`), role: 'assistant', content, source },
    stream: [],
  }, { surfaceOp: 'append' })
}

function toolCallEvent(seq: number, turn: number, step: number, callId: string, name: string): SessionLiveEventEntry {
  return at(seq, 'tool/call', { turn, step, callId: ToolCallId(callId), name, arguments: '{}' })
}

function toolResultEvent(seq: number, turn: number, step: number, callId: string): SessionLiveEventEntry {
  return at(seq, 'tool/result', {
    turn,
    step,
    callId: ToolCallId(callId),
    message: {
      id: MessageId(`tr-${seq}`),
      role: 'tool',
      toolCallId: ToolCallId(callId),
      content: [{ type: 'text', text: 'ok' }],
      source: { kind: 'tool', callId: ToolCallId(callId) },
    },
  }, { surfaceOp: 'append' })
}

function renderSeats(entries: readonly SessionEventLikeEntry[]) {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('chat')
  const snap = assembler.snapshot('chat') as ChatSnapshot
  const chatStore = createChatStore().create()
  const mode = createSnapshotStore<TranscriptViewMode>('detailed')
  const timing = createSnapshotStore<CollapseTiming>('completion')
  const replies = createSnapshotStore<FoldedReplies>('all')
  const presentation = derivePresentationPolicy(mode, timing, replies)
  const usePresentation = bindSnapshotSelector(presentation)
  const useStore = bindSnapshotSelector(chatStore)
  const t = makeTranslate(en, commonEn)
  const { getTriggerProps } = contextMenuHook()()
  const useGroupAction: ChatFlowSlotProps['useGroupAction'] = (hidden) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const element = ref.current
      if (element === null) return
      if (hidden) element.setAttribute('hidden', '')
      else element.removeAttribute('hidden')
    }, [hidden])
    return ref
  }
  const renderSlot: ChatFlowSlotProps['renderSlot'] = (slotName, owner, opts) => {
    if (slotName !== 'conversation.chat.node') return null
    const typed = owner as ChatNodeOwnerProps & { readonly node: ChatNode }
    const hookContext = opts?.hookContext as ChatNodeHookContext
    if (typed.node.kind === 'turn-process') {
      return (
        <TurnProcessNodeView
          node={typed.node}
          turnProcess={typed.turnProcess}
          t={t}
          {...allowAllAccess}
        />
      )
    }
    if (typed.node.kind === 'assistant-step') {
      return (
        <AssistantNodeView
          node={typed.node}
          groupPart={typed.groupPart}
          turnProcess={typed.turnProcess}
          openFile={vi.fn()}
          loadImage={vi.fn()}
          fileMentions={() => ({})}
          resolveFilePath={p => p}
          useDisclosure={CHAT_NODE_INJECT.hooks.disclosure({}, hookContext)}
          useGroupAction={useGroupAction}
          useTurnData={CHAT_NODE_INJECT.hooks.turnData({}, hookContext)}
          usePresentation={usePresentation}
          renderSlot={(name, subOwner, subOpts) =>
            name === 'conversation.chat.message.images'
              ? null
              : renderReasoningSlot(name, subOwner, subOpts)}
          t={t}
          sessionId={'s1' as SessionId}
          useContextMenu={() => ({ getTriggerProps })}
          {...allowAllAccess}
        />
      )
    }
    if (typed.node.kind === 'tool-call') {
      return <div data-testid={`tool-${typed.node.data.root.name}`}>{typed.node.data.root.name}</div>
    }
    if (typed.node.kind === 'user-message') {
      return <div data-testid="user-msg">user</div>
    }
    return null
  }
  const rendered = render(
    <div>
      {snap.order.map(key => (
        <ChatNodeSeat
          key={key}
          nodeKey={key}
          nodeStore={snap.nodes}
          useChatNode={(keyArg: string) => snap.nodes.source(keyArg).getSnapshot()}
          useChatNodeBottom={(keyArg: string) => snap.nodes.bottomSource(keyArg).getSnapshot()}
          useChatNodeProcess={(keyArg: string) => snap.nodes.processSource(keyArg).getSnapshot()}
          usePresentation={usePresentation}
          useStore={useStore}
          actions={chatStore.actions}
          renderSlot={renderSlot}
          t={t}
          deferCollapse={false}
          useGroupAction={useGroupAction}
          openFile={vi.fn()}
          inspectCall={vi.fn()}
          forkAt={vi.fn()}
          loadImage={vi.fn()}
        />
      ))}
    </div>,
  )
  return { ...rendered, assembler, chatStore }
}

afterEach(() => { cleanup() })
beforeEach(() => { localStorage.clear() })

describe('OpenAI process folding DOM presentation', () => {
  it('folds intermediate commentary and tool progress by default while keeping the final answer expanded, and allows manual expansion', () => {
    const view = renderSeats([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 1, 'check this'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Commentary: inspecting files' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'read', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'read'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'step/start', { turn: 1, step: 2 }),
      assistantEvent(9, 1, 2, [{ type: 'text', text: 'Final OpenAI Answer' }]),
      at(10, 'step/end', { turn: 1, step: 2 }),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    const toggle = view.container.querySelector<HTMLButtonElement>('[data-turn-process="1"]')!
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    const commentary = view.getByText('Commentary: inspecting files').closest('[data-chat-node-key]')!
    const tool = view.getByTestId('tool-read').closest('[data-chat-node-key]')!
    const finalAnswer = view.getByText('Final OpenAI Answer').closest('[data-chat-node-key]')!

    expect(commentary.hasAttribute('hidden')).toBe(true)
    expect(tool.hasAttribute('hidden')).toBe(true)
    expect(finalAnswer.hasAttribute('hidden')).toBe(false)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(commentary.hasAttribute('hidden')).toBe(false)
    expect(tool.hasAttribute('hidden')).toBe(false)
    expect(finalAnswer.hasAttribute('hidden')).toBe(false)
  })

  it('keeps unbounded OpenAI Turns (no reliable final answer) visible in the DOM', () => {
    const view = renderSeats([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 1, 'run tool'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Tool-only step commentary' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'bash'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    const toggle = view.container.querySelector<HTMLButtonElement>('[data-turn-process="1"]')!
    expect(toggle.disabled).toBe(true)
    const commentary = view.getByText('Tool-only step commentary').closest('[data-chat-node-key]')!
    const tool = view.getByTestId('tool-bash').closest('[data-chat-node-key]')!
    expect(commentary.hasAttribute('hidden')).toBe(false)
    expect(tool.hasAttribute('hidden')).toBe(false)
  })

  it('keeps DeepSeek intermediate replies visible by default while folding reasoning/tools', () => {
    const view = renderSeats([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 1, 'deepseek question'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(
        4,
        1,
        1,
        [
          { type: 'reasoning', text: 'DeepSeek thinking' },
          { type: 'text', text: 'DeepSeek intermediate reply' },
          { type: 'tool-call', id: ToolCallId('c1'), name: 'read', arguments: '{}' },
        ],
        { kind: 'model', provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
      toolCallEvent(5, 1, 1, 'c1', 'read'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'step/start', { turn: 1, step: 2 }),
      assistantEvent(
        9,
        1,
        2,
        [{ type: 'text', text: 'DeepSeek final answer' }],
        { kind: 'model', provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
      at(10, 'step/end', { turn: 1, step: 2 }),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    const intermediate = view.getByText('DeepSeek intermediate reply').closest('[data-chat-node-key]')!
    const tool = view.getByTestId('tool-read').closest('[data-chat-node-key]')!
    const finalAnswer = view.getByText('DeepSeek final answer').closest('[data-chat-node-key]')!

    expect(intermediate.hasAttribute('hidden')).toBe(false)
    expect(tool.hasAttribute('hidden')).toBe(true)
    expect(finalAnswer.hasAttribute('hidden')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  SessionEventLikeEntry, SessionLiveEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq, type SessionEvent, type SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { LlmAttemptId, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { inspectRequestPrompt } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
import {
  isOpenAiFormatSource, processEvidenceDefinition, turnProcessDefinition,
} from '../src/client/conversation-nodes/turn-process.ts'
import { keepsAllReplies, turnProcessAlwaysOpen } from '../src/client/contract/turn-process.ts'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'

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
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function at<Type extends keyof SessionEventMap>(
  seq: number,
  type: Type,
  data: SessionEventMap[Type],
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq: SessionSeq(seq),
      time: 1_700_000_000_000 + seq * 100,
      type,
      data,
      ...extra,
    } as SessionEvent,
  }
}

function userEvent(seq: number, text: string): SessionLiveEventEntry {
  return at(seq, 'user/message', {
    id: MessageId(`u-${seq}`),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function assistantEvent(
  seq: number,
  turn: number,
  step: number,
  content: readonly ContentBlock[],
  source: SessionEventMap['assistant/message']['message']['source'] = { kind: 'model', provider: 'openai', model: 'gpt-5' },
  extra: Partial<SessionEventMap['assistant/message']> = {},
): SessionLiveEventEntry {
  return at(seq, 'assistant/message', {
    turn,
    step,
    message: {
      id: MessageId(`a-${seq}`),
      role: 'assistant',
      content,
      source,
    },
    stream: [],
    ...extra,
  }, { surfaceOp: 'append' })
}

function toolCallEvent(seq: number, turn: number, step: number, callId: string, name: string): SessionLiveEventEntry {
  return at(seq, 'tool/call', {
    turn,
    step,
    callId: ToolCallId(callId),
    name,
    arguments: '{}',
  })
}

function toolResultEvent(seq: number, turn: number, step: number, callId: string, text = 'ok'): SessionLiveEventEntry {
  return at(seq, 'tool/result', {
    turn,
    step,
    message: {
      id: MessageId(`tr-${seq}`),
      role: 'tool',
      toolCallId: ToolCallId(callId),
      content: [{ type: 'text', text }],
      source: { kind: 'tool', callId: ToolCallId(callId) },
    },
  }, { surfaceOp: 'append' })
}

function createAssembler(entries: readonly SessionEventLikeEntry[] = [], hasMore = false) {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, hasMore)
  assembler.activateTarget('chat')
  return assembler
}

function chatSnapshot(assembler: ConversationNodeAssembler): ChatSnapshot {
  const snapshot = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (snapshot === undefined) throw new Error('missing chat snapshot')
  return snapshot
}

function turnProcessNode(snapshot: ChatSnapshot, turn: number): ChatNode<'turn-process'> | undefined {
  return snapshot.nodes.values().find(
    (node): node is ChatNode<'turn-process'> =>
      node.kind === 'turn-process' && (node as ChatNode<'turn-process'>).data.turn === turn,
  )
}

describe('isOpenAiFormatSource', () => {
  it('identifies OpenAI providers, models, and Responses replay envelopes', () => {
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'openai', model: 'gpt-5' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'openai-codex', model: 'gpt-5.3-codex' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'azure-openai-responses', model: 'custom' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'openrouter', model: 'openai/gpt-4o' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'custom', model: 'o3-mini' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'custom', model: 'o4-mini' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'custom', model: 'codex-mini' })).toBe(true)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'custom', model: 'chatgpt-4o-latest' })).toBe(true)
    expect(isOpenAiFormatSource({
      kind: 'model',
      provider: 'custom-gateway',
      model: 'custom-model',
      replayState: { response: { kind: 'pi-ai', api: 'openai-responses' } },
    })).toBe(true)
  })

  it('excludes DeepSeek routes and non-OpenAI providers', () => {
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'deepseek', model: 'deepseek-reasoner' })).toBe(false)
    expect(isOpenAiFormatSource({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-chat',
      replayState: { response: { kind: 'pi-ai', api: 'openai-completions' } },
    })).toBe(false)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'openrouter', model: 'deepseek/deepseek-r1' })).toBe(false)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'anthropic', model: 'claude-sonnet-4' })).toBe(false)
    expect(isOpenAiFormatSource({ kind: 'model', provider: 'test', model: 'test' })).toBe(false)
    expect(isOpenAiFormatSource(null)).toBe(false)
    expect(isOpenAiFormatSource('openai')).toBe(false)
    expect(isOpenAiFormatSource({ kind: 'model', replayState: null })).toBe(false)
    expect(isOpenAiFormatSource({ kind: 'model', replayState: { response: null } })).toBe(false)
  })
})

describe('OpenAI Turn process folding projection', () => {
  it('marks completed multi-step OpenAI Turns with a reliable final answer for intermediate reply folding', () => {
    const assembler = createAssembler([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 'fix the bug'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Let me inspect the file first.' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'read', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'read'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'step/start', { turn: 1, step: 2 }),
      assistantEvent(9, 1, 2, [{ type: 'text', text: 'Fixed the issue.' }]),
      at(10, 'step/end', { turn: 1, step: 2 }),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ], false)
    const snap = chatSnapshot(assembler)
    const process = turnProcessNode(snap, 1)
    expect(process?.data).toMatchObject({
      turn: 1,
      answerAnchorSeq: 9,
      answerStep: 2,
      messageCount: 1,
      toolCallCount: 1,
      openaiFormat: true,
      foldIntermediateReplies: true,
    })
    expect(keepsAllReplies('all', process?.data)).toBe(false)
    expect(turnProcessAlwaysOpen(process)).toBe(false)
  })

  it('keeps streaming OpenAI Turns open until turn/end settles', () => {
    const assembler = createAssembler([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 'hello'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Checking...' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'read', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'read'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'step/start', { turn: 1, step: 2 }),
    ], false)
    assembler.append({
      type: 'transient',
      event: {
        type: 'assistant/live-chunk',
        seq: 8.1,
        time: 1_700_000_001_000,
        data: { attemptId: LlmAttemptId('att-1'), turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'Streaming final answer' } },
      },
    })
    assembler.flush()
    const streaming = turnProcessNode(chatSnapshot(assembler), 1)
    expect(streaming?.data.openaiFormat).toBe(true)
    expect(streaming?.data.answerAnchorSeq).toBeNull()
    expect(turnProcessAlwaysOpen(streaming)).toBe(true)

    assembler.append(assistantEvent(9, 1, 2, [{ type: 'text', text: 'Streaming final answer' }]))
    assembler.append(at(10, 'step/end', { turn: 1, step: 2 }))
    assembler.flush()
    const beforeTurnEnd = turnProcessNode(chatSnapshot(assembler), 1)
    expect(beforeTurnEnd?.data.answerAnchorSeq).toBe(9)
    expect(turnProcessAlwaysOpen(beforeTurnEnd)).toBe(true)

    assembler.append(at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    assembler.flush()
    const completed = turnProcessNode(chatSnapshot(assembler), 1)
    expect(completed?.data.foldIntermediateReplies).toBe(true)
    expect(turnProcessAlwaysOpen(completed)).toBe(false)
  })

  it('keeps OpenAI Turns always open when there is no reliable final answer boundary, on error, or on abort', () => {
    const assembler = createAssembler([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 'run tool only'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Running command...' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'bash'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      at(9, 'turn/start', { turn: 2 }),
      userEvent(10, 'fail'),
      at(11, 'step/start', { turn: 2, step: 1 }),
      assistantEvent(12, 2, 1, [{ type: 'text', text: 'Working...' }]),
      at(13, 'step/end', { turn: 2, step: 1 }),
      at(14, 'turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } }),
      at(15, 'turn/start', { turn: 3 }),
      userEvent(16, 'abort'),
      at(17, 'step/start', { turn: 3, step: 1 }),
      assistantEvent(18, 3, 1, [{ type: 'text', text: 'Partial' }], undefined, { interrupted: true }),
      at(19, 'step/end', { turn: 3, step: 1 }),
      at(20, 'turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ], false)
    const snap = chatSnapshot(assembler)
    const unbounded = turnProcessNode(snap, 1)
    expect(unbounded?.data.openaiFormat).toBe(true)
    expect(unbounded?.data.answerAnchorSeq).toBeNull()
    expect(unbounded?.data.foldIntermediateReplies).toBeUndefined()
    expect(turnProcessAlwaysOpen(unbounded)).toBe(true)

    expect(turnProcessAlwaysOpen(turnProcessNode(snap, 2))).toBe(true)
    expect(turnProcessAlwaysOpen(turnProcessNode(snap, 3))).toBe(true)
  })

  it('preserves answer boundary and folding across partial window and prepend replay', () => {
    const tail: SessionEventLikeEntry[] = [
      at(8, 'step/start', { turn: 1, step: 2 }),
      assistantEvent(9, 1, 2, [{ type: 'text', text: 'Final answer.' }]),
      at(10, 'step/end', { turn: 1, step: 2 }),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const assembler = createAssembler(tail, true)
    const partialProcess = turnProcessNode(chatSnapshot(assembler), 1)
    expect(partialProcess?.data).toMatchObject({
      turn: 1,
      answerAnchorSeq: 9,
      answerStep: 2,
      openaiFormat: true,
      foldIntermediateReplies: true,
    })

    const head: SessionEventLikeEntry[] = [
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 'question'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(4, 1, 1, [
        { type: 'text', text: 'Commentary before tool.' },
        { type: 'tool-call', id: ToolCallId('c1'), name: 'read', arguments: '{}' },
      ]),
      toolCallEvent(5, 1, 1, 'c1', 'read'),
      toolResultEvent(6, 1, 1, 'c1'),
      at(7, 'step/end', { turn: 1, step: 1 }),
    ]
    assembler.prepend(head, false)
    assembler.flush()
    const fullProcess = turnProcessNode(chatSnapshot(assembler), 1)
    expect(fullProcess?.key).toBe(partialProcess?.key)
    expect(fullProcess?.data).toMatchObject({
      turn: 1,
      processStartSeq: 1,
      answerAnchorSeq: 9,
      answerStep: 2,
      messageCount: 1,
      toolCallCount: 1,
      openaiFormat: true,
      foldIntermediateReplies: true,
    })
  })

  it('does not alter DeepSeek reasoning Turn behavior', () => {
    const assembler = createAssembler([
      at(1, 'turn/start', { turn: 1 }),
      userEvent(2, 'reason about this'),
      at(3, 'step/start', { turn: 1, step: 1 }),
      assistantEvent(
        4,
        1,
        1,
        [
          { type: 'reasoning', text: 'Step 1 thinking' },
          { type: 'text', text: 'Intermediate DeepSeek reply' },
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
        [
          { type: 'reasoning', text: 'Step 2 thinking' },
          { type: 'text', text: 'Final DeepSeek answer' },
        ],
        { kind: 'model', provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
      at(10, 'step/end', { turn: 1, step: 2 }),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ], false)
    const process = turnProcessNode(chatSnapshot(assembler), 1)
    expect(process?.data).toMatchObject({
      turn: 1,
      answerAnchorSeq: 9,
      answerStep: 2,
      inlineReasoning: true,
      messageCount: 1,
      toolCallCount: 1,
    })
    expect(process?.data.openaiFormat).toBeUndefined()
    expect(process?.data.foldIntermediateReplies).toBeUndefined()
    expect(keepsAllReplies('all', process?.data)).toBe(true)
  })
})

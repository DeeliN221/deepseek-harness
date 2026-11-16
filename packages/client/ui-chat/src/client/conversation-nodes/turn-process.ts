import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/client'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import type { AssistantChatData, ChatNode, FinalAssistantChatData } from '../contract/chat-nodes.ts'
import {
  isSubagentDelegationTool, sameTurnProcessSpec, type TurnProcessSpec,
} from '../contract/turn-process.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import { toAssistantBlocks } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Turn-level disclosure controlling process rows before the finalized answer. */
    'turn-process': import('../contract/chat-nodes.ts').TurnProcessChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Process range and finalized answer boundary for this Turn. */
    'turn-process': TurnProcessSpec
  }
}

interface TurnProcessState {
  readonly turn: number
  readonly assistantStartByStep: ReadonlyMap<number, number>
  readonly messageCountByStep: ReadonlyMap<number, number>
  readonly openaiByStep: ReadonlyMap<number, boolean>
  readonly otherStartSeq?: number
  readonly controlAnchorSeq?: number
  readonly messageCount: number
  readonly toolCallCount: number
  readonly subagentCount: number
}

const OPENAI_PROVIDERS = new Set([
  'openai',
  'openai-codex',
  'openai-completions',
  'openai-responses',
  'azure-openai',
  'azure-openai-responses',
  'openai-codex-responses',
])

const OPENAI_RESPONSES_APIS = new Set([
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
])

function isDeepSeekName(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'deepseek' || normalized.startsWith('deepseek-') || normalized.startsWith('deepseek/')
}

function isOpenAiProviderName(provider: string): boolean {
  const normalized = provider.trim().toLowerCase()
  return OPENAI_PROVIDERS.has(normalized)
    || normalized.startsWith('openai-')
    || normalized.startsWith('openai/')
    || normalized.startsWith('azure-openai-')
    || normalized.startsWith('azure-openai/')
}

function isOpenAiModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const bare = normalized.startsWith('openai/') ? normalized.slice('openai/'.length) : normalized
  return /^gpt-/.test(bare)
    || /^o[134](?:-|$)/.test(bare)
    || /^codex(?:-|$)/.test(bare)
    || /^chatgpt-/.test(bare)
}

function replayApiOf(replayState: unknown): string | undefined {
  if (typeof replayState !== 'object' || replayState === null || !('response' in replayState)) return undefined
  const response = replayState.response
  if (typeof response !== 'object' || response === null || !('api' in response)) return undefined
  return typeof response.api === 'string' ? response.api : undefined
}

/**
 * Identify whether a durable `assistant/message` source belongs to an OpenAI-format provider.
 * DeepSeek routes are explicitly excluded even when served over OpenAI-compatible wire APIs.
 * @param source - Durable `ModelMessageSource` from `assistant/message`.
 * @returns Whether the message belongs to an OpenAI-format provider.
 */
export function isOpenAiFormatSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const provider = 'provider' in source && typeof source.provider === 'string' ? source.provider : ''
  const model = 'model' in source && typeof source.model === 'string' ? source.model : ''
  if (isDeepSeekName(provider) || isDeepSeekName(model)) return false
  if (isOpenAiProviderName(provider) || isOpenAiModelName(model)) return true
  const api = 'replayState' in source ? replayApiOf(source.replayState) : undefined
  return api !== undefined && OPENAI_RESPONSES_APIS.has(api)
}

function hasOpenAiStep(state: TurnProcessState): boolean {
  for (const matched of state.openaiByStep.values()) {
    if (matched) return true
  }
  return false
}

type ConversationEvent = Parameters<ConversationNodeDefinition['match']>[0]

function eventTurn(event: ConversationEvent): number | undefined {
  const data = event.data as unknown as { turn?: unknown }
  return typeof data.turn === 'number' ? data.turn : undefined
}

function visibleChunk(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.trim() !== ''
  if (chunk.type === 'block-start') {
    return chunk.blockType !== 'text'
        && chunk.blockType !== 'reasoning'
        && chunk.blockType !== 'tool-call'
  }
  if (chunk.type !== 'block-end') return false
  const block = chunk.block
  if (block.type === 'tool-call') return false
  if (block.type === 'text' || block.type === 'reasoning') return block.text.trim() !== ''
  return true
}

function visibleAssistantEvent(event: ConversationEvent): boolean {
  if (event.type === 'assistant/live-chunk') return visibleChunk(event.data.chunk)
  if (event.type === 'assistant/attempt') return false
  return event.type === 'assistant/message'
    && event.surfaceOp === 'append'
    && toAssistantBlocks(event.data.message.content).some((block) => {
      if (block.kind === 'tool-call') return false
      if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
      return true
    })
}

type ProcessEvidence =
  | { readonly kind: 'assistant'; readonly seq: number; readonly step: number }
  | { readonly kind: 'other'; readonly seq: number }

function processEvidence(event: ConversationEvent): ProcessEvidence | undefined {
  if (visibleAssistantEvent(event)) {
    if (event.type !== 'assistant/live-chunk'
      && event.type !== 'assistant/message'
      && event.type !== 'assistant/attempt') return undefined
    return { kind: 'assistant', seq: event.seq, step: event.data.step }
  }
  if (event.type === 'tool/call'
    || (event.type === 'tool/result' && event.surfaceOp === 'append')
    || event.type === 'llm/retry') return { kind: 'other', seq: event.seq }
  return undefined
}

/** Turn of one Step that recorded durable process evidence. */
export interface ProcessEvidenceState {
  readonly turn: number
}

function durableEvidenceStep(event: ConversationEvent): { readonly turn: number; readonly step: number } | undefined {
  if (processEvidence(event) === undefined) return undefined
  switch (event.type) {
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'llm/retry':
      return { turn: event.data.turn, step: event.data.step }
    default:
      return undefined
  }
}

/**
 * State-only record of each Step whose durable events include process evidence, keyed by Turn and Step.
 * An input follows its Turn's process control exactly when its Turn recorded evidence before it, so an
 * input reads the nearest earlier record through `reader.previous`. A Step's evidence is logged before
 * a later Step admits input, so the record a later input reads no longer changes; transient live chunks
 * are not needed because a Step's durable settlement precedes the next Step's input.
 */
export const processEvidenceDefinition: ConversationNodeDefinition<ProcessEvidenceState> = {
  kind: 'process-evidence',
  match: (event) => {
    const coordinates = durableEvidenceStep(event)
    return coordinates === undefined ? null : { id: `${coordinates.turn}:${coordinates.step}`, role: 'start' }
  },
  start: (_context, match) => {
    const coordinates = durableEvidenceStep(match.event)
    if (coordinates === undefined) throw new Error('process-evidence start requires durable process evidence')
    return { turn: coordinates.turn }
  },
  update: context => context.state,
  publication: () => 'none',
}

function turnLocation(context: ConversationNodeContext<TurnProcessState>): TurnLocation | undefined {
  const location: ConversationLocation | undefined = context.start?.location ?? context.matches.at(-1)?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
}

function fallbackState(context: ConversationNodeContext<TurnProcessState>): TurnProcessState | undefined {
  const turn = context.matches.map(match => eventTurn(match.event)).find(candidate => candidate !== undefined)
  if (turn === undefined) return undefined
  let state: TurnProcessState = {
    turn,
    assistantStartByStep: new Map(),
    messageCountByStep: new Map(),
    openaiByStep: new Map(),
    messageCount: 0,
    toolCallCount: 0,
    subagentCount: 0,
  }
  for (const match of context.matches) state = updateProcessState(state, match.event)
  return state
}

function isFinalAssistant(
  data: Readonly<AssistantChatData> | undefined,
): data is Readonly<FinalAssistantChatData> {
  return data?.finalNode !== undefined
}

function latestAnswer(turn: TurnLocation): Readonly<FinalAssistantChatData> | null {
  const latestStep = turn.steps.at(-1)
  const data: Readonly<AssistantChatData> | undefined = latestStep?.data.get('assistant-step')
  if (!isFinalAssistant(data) || !hasAssistantReplyContent(data.blocks)) return null
  return data.blocks.some(block => block.kind === 'tool-call') ? null : data
}

function processSpec(state: TurnProcessState, turn: TurnLocation): TurnProcessSpec | null {
  const controlAnchorSeq = state.controlAnchorSeq ?? turn.start?.seq
  if (controlAnchorSeq === undefined) return null
  const answer = latestAnswer(turn)
  const counts = {
    messageCount: answer === null
      ? state.messageCount
      : [...state.messageCountByStep]
        .filter(([step]) => step < answer.step)
        .reduce((total, [, count]) => total + count, 0),
    toolCallCount: state.toolCallCount,
    subagentCount: state.subagentCount,
  }
  if (answer === null) {
    return {
      turn: turn.turn,
      controlAnchorSeq,
      processStartSeq: controlAnchorSeq,
      answerAnchorSeq: null,
      answerStep: null,
      inlineReasoning: false,
      ...counts,
      ...hasOpenAiStep(state) ? { openaiFormat: true as const } : {},
    }
  }
  const openaiFormat = state.openaiByStep.get(answer.step) === true
  const inlineReasoning = answer.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
  const earlierAssistantSeq = Math.min(
    ...[...state.assistantStartByStep]
      .filter(([step]) => step < answer.step)
      .map(([, seq]) => seq),
  )
  const externalProcessSeq = Math.min(
    state.otherStartSeq ?? Number.POSITIVE_INFINITY,
    earlierAssistantSeq,
  )
  return {
    turn: turn.turn,
    controlAnchorSeq,
    processStartSeq: turn.start?.seq
      ?? (Number.isFinite(externalProcessSeq) ? externalProcessSeq : answer.finalNode.seq),
    answerAnchorSeq: answer.finalNode.seq,
    answerStep: answer.step,
    inlineReasoning,
    ...counts,
    ...openaiFormat ? { openaiFormat: true as const, foldIntermediateReplies: true as const } : {},
  }
}

function updateProcessState(state: TurnProcessState, event: ConversationEvent): TurnProcessState {
  let current = state
  if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
    const openaiByStep = new Map(current.openaiByStep)
    openaiByStep.set(event.data.step, isOpenAiFormatSource(event.data.message.source))
    current = { ...current, openaiByStep }
    if (hasAssistantReplyContent(toAssistantBlocks(event.data.message.content))) {
      const messageCountByStep = new Map(current.messageCountByStep)
      messageCountByStep.set(event.data.step, (messageCountByStep.get(event.data.step) ?? 0) + 1)
      current = { ...current, messageCountByStep, messageCount: current.messageCount + 1 }
    }
  }
  if (event.type === 'tool/call') {
    const subagent = isSubagentDelegationTool(event.data.name)
    current = {
      ...current,
      toolCallCount: current.toolCallCount + (subagent ? 0 : 1),
      subagentCount: current.subagentCount + (subagent ? 1 : 0),
    }
  }
  const evidence = processEvidence(event)
  if (evidence === undefined) return current
  if (evidence.kind === 'other') {
    return current.otherStartSeq === undefined
      ? {
        ...current,
        otherStartSeq: evidence.seq,
        controlAnchorSeq: Math.min(current.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq),
      }
      : current
  }
  if (current.assistantStartByStep.has(evidence.step)) return current
  const assistantStartByStep = new Map(current.assistantStartByStep)
  assistantStartByStep.set(evidence.step, evidence.seq)
  return {
    ...current,
    assistantStartByStep,
    controlAnchorSeq: Math.min(current.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq),
  }
}

/** Turn-scoped process range and answer-boundary Definition. */
export const turnProcessDefinition: ConversationNodeDefinition<TurnProcessState> = {
  kind: 'turn-process',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    const turn = eventTurn(event)
    if (turn === undefined) return null
    if (event.type === 'assistant/live-chunk'
      || event.type === 'assistant/message'
      || event.type === 'tool/call'
      || event.type === 'tool/result'
      || event.type === 'llm/retry'
      || event.type === 'step/start'
      || event.type === 'step/end'
      || event.type === 'turn/end') {
      return { id: String(turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('turn-process start requires turn/start')
    return {
      turn: match.event.data.turn,
      assistantStartByStep: new Map(),
      messageCountByStep: new Map(),
      openaiByStep: new Map(),
      messageCount: 0,
      toolCallCount: 0,
      subagentCount: 0,
    }
  },
  update: (context, match) => updateProcessState(context.state, match.event),
  publication: (match) => {
    if (match.event.type === 'assistant/live-chunk') {
      const type = match.event.data.chunk.type
      return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
    }
    return 'immediate'
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn') return null
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const turn = turnLocation(context)
    if (turn === undefined) return null
    const current = context.current.get('chat') as ChatNode | null | undefined
    const latestStep = turn.steps.at(-1)
    if (previous?.kind === 'turn'
      && previous.key === 'turn-process'
      && current?.kind === 'turn-process'
      && current.data.answerAnchorSeq === null
      && current.data.controlAnchorSeq === state.controlAnchorSeq
      && current.data.messageCount === state.messageCount
      && current.data.toolCallCount === state.toolCallCount
      && current.data.subagentCount === state.subagentCount
      && Boolean(current.data.openaiFormat) === hasOpenAiStep(state)
      && turn.status !== 'closed'
      && latestStep?.status !== 'closed') return previous
    const spec = processSpec(state, turn)
    if (spec === null) return null
    if (previous?.kind === 'turn'
      && previous.turn === spec.turn
      && previous.key === 'turn-process'
      && sameTurnProcessSpec(previous.value, spec)) return previous
    return {
      kind: 'turn',
      turn: turn.turn,
      key: 'turn-process',
      value: spec,
    }
  },
  buildViewNode: (context) => {
    const turn = turnLocation(context)
    const data = turn?.data.get('turn-process')
    if (turn === undefined || data === undefined) return null
    const current = context.current.get('chat') as ChatNode | null | undefined
    const state = context.state
    if (current?.kind === 'turn-process'
      && state !== undefined
      && current.data.answerAnchorSeq === null
      && current.data.controlAnchorSeq === state.controlAnchorSeq
      && current.data.messageCount === state.messageCount
      && current.data.toolCallCount === state.toolCallCount
      && current.data.subagentCount === state.subagentCount
      && Boolean(current.data.openaiFormat) === hasOpenAiStep(state)
      && turn.status !== 'closed'
      && turn.steps.at(-1)?.status !== 'closed'
      && current.location === (context.start?.location ?? context.matches[0]?.location)) return current
    return chatNode(
      context,
      'turn-process',
      data.controlAnchorSeq + CHAT_SYNTHETIC_SEQ_OFFSETS.processControl,
      data,
      { groupTree: 'turn' },
    )
  },
}

/**
 * Register the Turn-scoped process disclosure projection and its per-Step evidence record.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnProcess(ctx: Context): void {
  const match = turnProcessDefinition.match.bind(turnProcessDefinition)
  ctx.uiConversation.events.register({
    ...turnProcessDefinition,
    match: {
      'turn/start': match,
      'assistant/live-chunk': match,
      'assistant/message': match,
      'tool/call': match,
      'tool/result': match,
      'llm/retry': match,
      'step/start': match,
      'step/end': match,
      'turn/end': match,
    },
  })
  const evidence = processEvidenceDefinition.match.bind(processEvidenceDefinition)
  ctx.uiConversation.events.register({
    ...processEvidenceDefinition,
    match: {
      'assistant/message': evidence,
      'tool/call': evidence,
      'tool/result': evidence,
      'llm/retry': evidence,
    },
  })
}

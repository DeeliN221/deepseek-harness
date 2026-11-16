import type { FoldedReplies } from '../../chat-settings.ts'
import type { ChatNode } from './chat-nodes.ts'

/** Current process range and finalized answer boundary derived from one Turn. */
export interface TurnProcessSpec {
  readonly turn: number
  /** Stable control-node anchor source, including currently ineligible evidence. */
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  /** Reply-bearing durable Assistant messages before the final answer. */
  readonly messageCount: number
  /** Durable non-subagent Tool calls recorded by this Turn. */
  readonly toolCallCount: number
  /** Tool calls whose configured name identifies a subagent delegation. */
  readonly subagentCount: number
  /** Present when settled Assistant output originates from an OpenAI-format provider. */
  readonly openaiFormat?: true
  /** Present when intermediate Assistant replies fold into the Turn process by default. */
  readonly foldIntermediateReplies?: true
}

/**
 * Compare immutable Turn-process specifications by their published fields.
 * @param left - previous specification.
 * @param right - next specification.
 * @returns whether both values describe the same process presentation.
 */
export function sameTurnProcessSpec(left: TurnProcessSpec, right: TurnProcessSpec): boolean {
  return left.turn === right.turn
    && left.controlAnchorSeq === right.controlAnchorSeq
    && left.processStartSeq === right.processStartSeq
    && left.answerAnchorSeq === right.answerAnchorSeq
    && left.answerStep === right.answerStep
    && left.inlineReasoning === right.inlineReasoning
    && left.messageCount === right.messageCount
    && left.toolCallCount === right.toolCallCount
    && left.subagentCount === right.subagentCount
    && left.openaiFormat === right.openaiFormat
    && left.foldIntermediateReplies === right.foldIntermediateReplies
}

/**
 * Whether every Assistant reply stays outside whole-Turn folding for one Turn.
 * @param foldedReplies - user-selected reply visibility policy.
 * @param spec - owning Turn's process specification, when available.
 * @returns whether intermediate replies remain visible outside the process fold.
 */
export function keepsAllReplies(
  foldedReplies: FoldedReplies,
  spec: Pick<TurnProcessSpec, 'foldIntermediateReplies'> | undefined,
): boolean {
  return foldedReplies === 'all' && spec?.foldIntermediateReplies !== true
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/**
 * Keep live, stopped, failed, and unbounded OpenAI-format Turns open.
 * @param node - Node carrying the owning Turn.
 * @returns whether whole-Turn collapse is unavailable.
 */
export function turnProcessAlwaysOpen(node: ChatNode | undefined): boolean {
  const location = node?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return false
  const reason = location.turn.end?.data.reason.kind
  if (location.turn.status === 'open' || reason === 'aborted' || reason === 'interrupted' || reason === 'error') {
    return true
  }
  const spec = location.turn.data.get('turn-process')
  return spec?.openaiFormat === true && spec.answerAnchorSeq === null
}

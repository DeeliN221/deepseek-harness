/** Turn-end self-check that keeps a session moving unless work is truly finished or blocked. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Model declaration about one human request. */
export type TurnGuardStatus = 'continue' | 'done' | 'blocked'

/** Default question the host asks when a turn ends with work still in progress. */
export const DEFAULT_TURN_GUARD_QUESTION =
  '任务是否全部完成，停在这是否真是因为必须由用户做方向性决策或者高危操作批准？'
  + '如果不是，请继续自动推进，不要等待用户简单发送继续指令催促。'

/** Per-agent continuation bookkeeping for the current human request. */
export interface TurnGuardState {
  /** Automatic self-check prompts admitted since the last human message. */
  rounds: number
  /** Latest declaration for this human request. */
  status: TurnGuardStatus
  /** Whether a model step ran since the last human message or guard prompt. */
  dirty: boolean
  /** Whether a guard prompt is queued and not yet claimed. */
  pending: boolean
}

/** Create the state for one exact agent lifecycle. */
export function createTurnGuardState(): TurnGuardState {
  return { rounds: 0, status: 'continue', dirty: false, pending: false }
}

/** Reset every guard fact for a new human request. */
export function resetTurnGuard(state: TurnGuardState): void {
  state.rounds = 0
  state.status = 'continue'
  state.dirty = false
  state.pending = false
}

/** Whether the guard must stay silent for the current human request. */
export function guardStop(state: TurnGuardState, maxRounds: number): boolean {
  return state.status === 'done' || state.status === 'blocked' || state.rounds >= maxRounds
}

/**
 * Render the self-check prompt injected after a turn ends with work in progress.
 * @param round - next positive auto-continue round.
 * @param maxRounds - configured round allowance for one human request.
 * @param question - operator-configured question, appended verbatim.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderTurnGuardPrompt(round: number, maxRounds: number, question: string): ContentBlock[] {
  return [{
    type: 'text',
    text: '<turn_guard>\n'
      + `任务自检（第 ${round}/${maxRounds} 轮）：${question}\n\n`
      + '先判断：如果任务已全部完成，调用 turn_status 声明 done；如果确实需要用户做方向性决策或批准高危操作，'
      + '调用 turn_status 声明 blocked 并给出具体原因；否则继续自动推进，不要停下来等待用户催问。\n'
      + '</turn_guard>',
  }]
}

/**
 * Model-facing policy for the turn-end declaration.
 * @param maxRounds - configured round allowance, quoted so the model can budget.
 * @returns one prompt section body.
 */
export function renderTurnGuardGuidance(maxRounds: number): string {
  return 'Before ending a turn, call turn_status to declare the state of the current task: '
    + 'done when the whole task is complete and verified, blocked only when a user decision '
    + 'or an explicit high-risk approval is genuinely required (include the concrete reason), '
    + 'and continue when work remains. Never end a turn merely because one step finished: keep '
    + 'advancing in the same turn while work remains. If you stop early, the host asks the '
    + `self-check question again automatically, up to ${maxRounds} times per human request.`
}

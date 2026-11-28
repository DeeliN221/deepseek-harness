/**
 * Same-session goal-round driver over public agent, session, and goal services.
 * @module @deepseek-ai/dsh-goal-round-driver
 */

import { isDeepStrictEqual } from 'node:util'
import z from '@deepseek-ai/schemastery'
import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { GoalMessageSource, GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import { HarnessError, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderGoalRoundPrompt } from './prompt.ts'
import {
  DEFAULT_TURN_GUARD_QUESTION,
  createTurnGuardState,
  guardStop,
  renderTurnGuardGuidance,
  renderTurnGuardPrompt,
  resetTurnGuard,
} from './turn-guard.ts'
import type { TurnGuardState } from './turn-guard.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'turn-guard': { kind: 'turn-guard'; round: number }
  }
}

export { renderGoalRoundPrompt } from './prompt.ts'
export {
  DEFAULT_TURN_GUARD_QUESTION,
  createTurnGuardState,
  guardStop,
  renderTurnGuardGuidance,
  renderTurnGuardPrompt,
  resetTurnGuard,
} from './turn-guard.ts'
export type { TurnGuardState, TurnGuardStatus } from './turn-guard.ts'

export const name = 'goal-round-driver'
export const inject = ['agents', 'goals', 'sessions', 'tools', 'systemPrompt']

/** Turn-end self-check policy; goal-round scheduling itself remains config-free. */
export interface Config {
  /** Enable the automatic turn-end self-check and its `turn_status` tool. */
  turnGuardEnabled?: boolean
  /** Maximum automatic self-check rounds admitted for one human request. */
  turnGuardMaxRounds?: number
  /** Question injected when a turn ends with work still in progress. */
  turnGuardQuestion?: string
}

/** Schemastery config for the turn-end self-check. */
export const Config: z<Config> = z.object({
  turnGuardEnabled: z.boolean().default(true),
  turnGuardMaxRounds: z.number().step(1).min(1).default(8),
  turnGuardQuestion: z.string().default(DEFAULT_TURN_GUARD_QUESTION),
})

/** Identity reserved before a goal continuation enters the agent inbox. */
interface RoundIdentity {
  readonly goalId: GoalRef['id']
  readonly revision: number
  readonly round: number
}

/** One queued, claimed, or admitted goal message retained until whole-agent quiescence. */
interface RoundAttempt extends RoundIdentity {
  readonly messageId: MessageId
  readonly content: ContentBlock[]
  phase: 'queued' | 'claimed' | 'admitted'
  cancelled: boolean
  stale: boolean
}

/** Serialized process-local scheduling state for one exact Agent lifecycle. */
interface DriverState {
  readonly agent: Agent
  attempt: RoundAttempt | undefined
  competingQueued: boolean
  needsCheckpoint: boolean
  requested: boolean
  run: Promise<void> | undefined
  stopping: boolean
  /** Turn-end self-check facts for the current human request. */
  readonly guard: TurnGuardState
}

/** Whether a source identifies an automatic, positive-numbered goal round. */
function isGoalRoundSource(source: MessageSource): source is GoalMessageSource {
  return source.kind === 'goal' && source.round > 0
}

/** Compare a source to one reserved identity. */
function sameRound(source: GoalMessageSource, round: RoundIdentity): boolean {
  return source.goalId === round.goalId
    && source.revision === round.revision
    && source.round === round.round
}

/** Compare the complete queued record to the driver's reservation. */
function sameQueued(content: readonly ContentBlock[], source: MessageSource, attempt: RoundAttempt): boolean {
  return isGoalRoundSource(source) && sameRound(source, attempt) && isDeepStrictEqual(content, attempt.content)
}

/** Exact current ref for a view. */
function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

/** Human-readable unexpected values for logs. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Install automatic same-session continuation and its race fences. */
export function apply(ctx: Context, config: Config = {}): void {
  const guard = {
    enabled: config.turnGuardEnabled ?? true,
    maxRounds: config.turnGuardMaxRounds ?? 8,
    question: config.turnGuardQuestion ?? DEFAULT_TURN_GUARD_QUESTION,
  }
  const states = new Map<Agent, DriverState>()
  // Releases drivers still joining subagents when the plugin unloads.
  const unloading = Promise.withResolvers<void>()

  /** Create state for an exact currently live agent. */
  function stateFor(agent: Agent): DriverState {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const state: DriverState = {
      agent,
      attempt: undefined,
      competingQueued: false,
      needsCheckpoint: false,
      requested: false,
      run: undefined,
      stopping: false,
      guard: createTurnGuardState(),
    }
    states.set(agent, state)
    return state
  }

  /** Read only when the exact Agent remains live. */
  function currentGoal(state: DriverState): GoalView | undefined {
    if (ctx.agents.get(state.agent.id) !== state.agent) return undefined
    return ctx.goals.get(state.agent)
  }

  /** Whether a goal may receive automatic rounds. */
  function drivable(goal: GoalView | undefined): goal is GoalView {
    return goal !== undefined && goal.phase === 'active' && goal.activation === 'armed'
  }

  /** Whether this exact lifecycle is quiescent with no competing prompt. */
  function readyToDrive(state: DriverState): boolean {
    return ctx.fiber.state === FiberState.ACTIVE
      && !state.stopping
      && ctx.agents.get(state.agent.id) === state.agent
      && state.agent.status === 'idle'
      && !state.competingQueued
  }

  /** Recheck every condition that an awaited checkpoint may have changed. */
  function readyAfterCheckpoint(state: DriverState): boolean {
    return readyToDrive(state) && !state.needsCheckpoint
  }

  /** Whether this exact agent is a delegated subagent rather than the session root. */
  function delegated(agent: Agent): boolean {
    return agent.session.header.origin === 'subagent'
  }

  /** Queue one turn-end self-check prompt when a turn ends with work still open. */
  function maybeGuard(state: DriverState): void {
    if (!guard.enabled || state.stopping) return
    if (ctx.fiber.state !== FiberState.ACTIVE) return
    if (ctx.agents.get(state.agent.id) !== state.agent) return
    if (state.agent.status !== 'idle') return
    if (state.guard.pending || !state.guard.dirty) return
    if (guardStop(state.guard, guard.maxRounds)) return
    if (delegated(state.agent)) return
    const goal = currentGoal(state)
    if (goal !== undefined) {
      // Active, paused, or blocked goals have their own owner: the driver keeps an
      // armed goal moving, a paused goal is a human decision, and a blocked goal
      // already recorded why it waits. A completed goal counts as a done task.
      if (goal.phase === 'complete') state.guard.status = 'done'
      return
    }
    if (state.agent.inbox.nextTurn.length > 0 || state.agent.inbox.nextStep.length > 0) return
    const round = state.guard.rounds + 1
    state.guard.pending = true
    try {
      state.agent.followup(createUserMessage({
        content: renderTurnGuardPrompt(round, guard.maxRounds, guard.question),
        source: { kind: 'turn-guard', round },
      }))
      state.guard.rounds = round
    } catch (error: unknown) {
      state.guard.pending = false
      ctx.logger.warn(`goal-round-driver: could not queue turn-guard round ${round} for agent "${state.agent.id}": ${renderThrown(error)}`)
    }
  }

  if (guard.enabled) {
    ctx.systemPrompt.section({
      name: 'turn-guard',
      order: ctx.systemPrompt.getSectionOrder('TOOL_GOAL') + 1,
      text: renderTurnGuardGuidance(guard.maxRounds),
    })
    ctx.tools.register(defineTool({
      name: 'turn_status',
      description: 'Declare whether the current task is finished. Call this before ending a turn: done when the whole '
        + 'task is complete and verified, blocked only when a user decision or an explicit high-risk approval is '
        + 'genuinely required (include reason), and continue when work remains. The host asks the self-check question '
        + 'again automatically when a turn ends while work is still in progress.',
      parameters: {
        status: {
          type: 'string',
          required: true,
          enum: ['continue', 'done', 'blocked'],
          description: 'Declared state of the current task.',
        },
        reason: {
          type: 'string',
          description: 'Concrete reason; required when status is blocked.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `turn_status: ${value.status}` }],
      },
      execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined || ctx.agents.get(agent.id) !== agent || agent.status !== 'running') {
          throw new HarnessError(
            'turn_status requires the live calling agent inside its active turn',
            'TURN_GUARD_AGENT_REQUIRED',
          )
        }
        const status = args.status
        if (status === 'blocked' && (args.reason === undefined || args.reason.trim().length === 0)) {
          throw new HarnessError('reason is required when status is blocked', 'TURN_GUARD_REASON_REQUIRED')
        }
        stateFor(agent).guard.status = status
        return Promise.resolve({ status })
      },
    }))
  }

  /** Remove automatic authority while preserving the durable phase. */
  function disarm(state: DriverState): void {
    try {
      const goal = currentGoal(state)
      if (goal?.activation === 'armed') ctx.goals.disarm(state.agent)
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: could not disarm agent "${state.agent.id}": ${renderThrown(error)}`)
    }
  }

  /** Preserve claimed step context when this driver drops only its own round. */
  function restoreOtherClaimed(agent: Agent, messages: UserMessage[], messageId: MessageId): void {
    const retained = messages.filter(message => message.id !== messageId
      && !(message.source.kind === 'goal' && message.source.round === 0))
    for (const message of retained.toReversed()) {
      if (agent.inbox.nextStep.some(candidate => candidate.id === message.id)
        || agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) continue
      agent.inbox.prepend('next-step', message)
    }
  }

  /** Process admitted work at quiescence, then reserve at most one next round. */
  async function drive(state: DriverState): Promise<void> {
    const { agent } = state
    if (!readyToDrive(state)) return

    if (state.needsCheckpoint) {
      state.needsCheckpoint = false
      try {
        await ctx.sessions.flush(agent.session)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: durability checkpoint failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        return
      }
      // A mutation or ordinary prompt may have arrived while the checkpoint
      // was settling. Give it its own checkpoint / turn before reserving.
      if (!readyAfterCheckpoint(state)) return
    }

    const attempt = state.attempt
    if (attempt !== undefined) {
      state.attempt = undefined
      state.needsCheckpoint = true
      state.requested = true
      return
    }

    const goal = currentGoal(state)
    if (!drivable(goal)) return
    // A round started while descendants progress would only wait for them.
    // Every goal mutation requests a checkpoint, so passing the recheck
    // proves this goal view is still current.
    const subagents = ctx.get('subagents')
    if (subagents !== undefined) {
      await Promise.race([subagents.waitForTreeWork(agent), unloading.promise])
      if (!readyAfterCheckpoint(state)) return
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      ctx.goals.block(agent, goalRef(goal), {
        code: 'round-limit',
        message: `Goal reached its configured limit of ${goal.maxGoalRounds} rounds.`,
      })
      return
    }

    const round = goal.roundsStarted + 1
    const content = renderGoalRoundPrompt(goal, round)
    const message = createUserMessage({
      content,
      source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
    })
    const reservation: RoundAttempt = {
      goalId: goal.id,
      revision: goal.revision,
      round,
      messageId: message.id,
      content,
      phase: 'queued',
      cancelled: false,
      stale: false,
    }
    state.attempt = reservation
    try {
      agent.followup(message)
    } catch (error: unknown) {
      state.attempt = undefined
      ctx.logger.warn(`goal-round-driver: could not queue round ${round} for agent "${agent.id}": ${renderThrown(error)}`)
      const latest = currentGoal(state)
      if (latest !== undefined && latest.id === goal.id && latest.revision === goal.revision
        && latest.phase === 'active' && latest.activation === 'armed') {
        ctx.goals.block(agent, goalRef(latest), {
          code: 'queue-failed',
          message: `Could not queue goal round ${round}: ${renderThrown(error)}`,
        })
      }
    }
  }

  /** Coalesce triggers onto one agent-local serialized driver. */
  function requestDrive(state: DriverState): void {
    /* v8 ignore next -- teardown may race a final trigger after synchronously closing the step fence */
    if (state.stopping) return
    state.requested = true
    if (state.run !== undefined) return
    let run: Promise<void>
    try {
      run = ctx.agents.withoutInitiator(async () => {
        while (state.requested && !state.stopping) {
          state.requested = false
          try {
            await drive(state)
          } catch (error: unknown) {
            ctx.logger.warn(`goal-round-driver: driver failed for agent "${state.agent.id}": ${renderThrown(error)}`)
            disarm(state)
          }
        }
      })
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: could not start driver for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      return
    }
    state.run = run
    const retire = (): void => {
      state.run = undefined
      if (state.requested && !state.stopping) requestDrive(state)
    }
    void run.then(retire, (error: unknown) => {
      ctx.logger.warn(`goal-round-driver: driver task rejected for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      retire()
    })
  }

  // One composite effect keeps the step fence installed until this
  // plugin's own scheduling tasks settle.
  ctx.effect(function* () {
    ctx.on('agent/error', ({ agent }) => {
      const state = stateFor(agent)
      disarm(state)
    })

    ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) })
    ctx.on('agent/created', ({ agent }) => {
      const state = stateFor(agent)
      state.attempt = undefined
      state.competingQueued = false
      state.needsCheckpoint = false
    })
    ctx.on('agent/status', ({ agent, status }) => {
      const state = stateFor(agent)
      if (status === 'idle') {
        state.competingQueued = false
        const attempt = state.attempt
        const goal = currentGoal(state)
        // Fence the pause to the exact dropped attempt's ref. A resume bumps
        // the revision, so a host pause followed by an immediate resume (before
        // the aborted turn converges to idle) must not re-pause the resumed goal.
        const pause = attempt !== undefined
          && (attempt.phase === 'queued' || attempt.phase === 'claimed' || attempt.cancelled)
          && goal !== undefined && goal.phase === 'active' && goal.activation === 'armed'
          && attempt.goalId === goal.id && attempt.revision === goal.revision
        // A reservation still queued when the agent reaches idle cannot run:
        // withdraw it so human input queued behind it is not stranded.
        if (pause || attempt?.phase === 'queued') {
          state.attempt = undefined
          try {
            if (attempt.phase === 'queued') agent.inbox.remove(attempt.messageId)
            if (pause) ctx.goals.pause(agent, goalRef(goal))
          } catch (error: unknown) {
            ctx.logger.warn(`goal-round-driver: could not settle cancelled goal round for agent "${agent.id}": ${renderThrown(error)}`)
            disarm(state)
          }
        }
        requestDrive(state)
        maybeGuard(state)
      }
    })
    ctx.on('goal/changed', ({ agent, change }) => {
      const state = stateFor(agent)
      state.needsCheckpoint = true
      // A host-initiated pause stops goal execution: abort the live turn so the
      // model cannot keep acting or resume in the same turn. A model-initiated
      // pause (update_goal inside its own turn) finishes normally.
      if (change.operation === 'pause' && agent.status === 'running'
        && ctx.agents.currentInitiator() !== agent) {
        agent.cancel({ kind: 'user' }, { keepInbox: true })
      }
      requestDrive(state)
    })

    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) return
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) return
      state.competingQueued = true
      if (attempt?.phase === 'queued') attempt.stale = true
    })
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) {
        attempt.phase = 'claimed'
      }
      if (message.source.kind === 'user') {
        resetTurnGuard(state.guard)
        // A claimed human message opens a turn, so the work marker survives any
        // turn/start ordering race with this reset.
        state.guard.dirty = true
      }
      else if (message.source.kind === 'turn-guard') {
        state.guard.pending = false
        state.guard.dirty = true
      }
    })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) {
        attempt.cancelled = true
      }
    })

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const agent = ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      const state = stateFor(agent)
      switch (event.type) {
        case 'user/message':
          if (state.attempt !== undefined && event.data.id === state.attempt.messageId) {
            state.attempt.phase = 'admitted'
          }
          return
        case 'turn/start':
          // A started turn proves real work for the current human request.
          if (!delegated(agent)) state.guard.dirty = true
          return
        case 'turn/end':
          if (event.data.reason.kind === 'max-tokens') {
            disarm(state)
            return
          }
          if (event.data.reason.kind !== 'aborted') return
          const abortReason = event.data.reason.reason
          // A human cancellation must not be answered by an automatic self-check.
          if (abortReason.kind === 'user') state.guard.status = 'blocked'
          // Agent disposal aborts the round without a pause decision, so continuation
          // is only disarmed and the durable phase stays active, as on driver unload.
          if (abortReason.kind === 'disposed') {
            disarm(state)
            return
          }
          if (state.attempt?.phase === 'claimed' || state.attempt?.phase === 'admitted') {
            state.attempt.cancelled = true
          }
          else disarm(state)
          return
        default:
          return
      }
    })

    /** Fail closed unless the queued prompt still owns the exact live revision. */
    function validReservation(
      state: DriverState,
      content: readonly ContentBlock[],
      source: GoalMessageSource,
    ): boolean {
      const attempt = state.attempt
      const goal = currentGoal(state)
      return ctx.fiber.state === FiberState.ACTIVE
        && !state.stopping && attempt !== undefined && attempt.phase === 'claimed'
      && !attempt.stale && sameQueued(content, source, attempt)
      && goal !== undefined && goal.id === source.goalId && goal.revision === source.revision
      && goal.phase === 'active' && goal.activation === 'armed'
      && source.round === goal.roundsStarted + 1
    }

    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      const submitted = messages.find((message): message is UserMessage & { source: GoalMessageSource } =>
        isGoalRoundSource(message.source))
      if (submitted === undefined) return next()
      const { content, source } = submitted
      const state = stateFor(agent)
      let valid = false
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: pre-step check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
      }
      if (!valid) {
        const attempt = state.attempt
        if (attempt !== undefined && sameRound(source, attempt)) {
          attempt.stale = true
          state.attempt = undefined
        }
        restoreOtherClaimed(agent, messages, submitted.id)
        requestDrive(state)
        return { kind: 'reject' }
      }
      let decision: PreStepDecision
      try {
        decision = await next()
      } catch (error: unknown) {
        if (signal.aborted) throw error
        // A throwing downstream hook drops the whole step proposal. Clear the
        // reservation before the balanced no-step turn returns to idle so the
        // next drive pass can reschedule the round.
        state.attempt = undefined
        requestDrive(state)
        throw error
      }
      if (signal.aborted) {
        if (decision.kind === 'enter') restoreOtherClaimed(agent, decision.messages, submitted.id)
        return decision
      }
      if (decision.kind === 'reject') {
        state.attempt = undefined
        const goal = currentGoal(state)
        if (goal !== undefined && goal.id === source.goalId && goal.revision === source.revision
          && goal.phase === 'active' && goal.activation === 'armed') {
          ctx.goals.block(agent, goalRef(goal), {
            code: 'prompt-rejected',
            message: 'Goal round was rejected before entering its step.',
          })
        }
        return decision
      }
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: post-decision check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        valid = false
      }
      if (!valid) {
        state.attempt = undefined
        restoreOtherClaimed(agent, decision.messages, submitted.id)
        requestDrive(state)
        return { kind: 'reject' }
      }
      return { ...decision, startsRequestSeries: true }
    })

    // Loading a lifecycle driver over existing agents never inherits hidden
    // automatic authority from an earlier producer instance.
    for (const agent of ctx.agents.list()) {
      const state = stateFor(agent)
      disarm(state)
    }

    // Yielded after listener registration, so this close runs first and the
    // composite effect removes listeners only after its promise settles.
    yield async () => {
      unloading.resolve()
      const waits: Promise<void>[] = []
      for (const state of states.values()) {
        state.stopping = true
        disarm(state)
        const attempt = state.attempt
        if (attempt !== undefined) {
          attempt.stale = true
          /* v8 ignore next -- followup reserves the live agent before publishing a queued attempt */
          if (state.agent.status === 'running') {
            state.agent.cancel({ kind: 'parent' })
            waits.push(state.agent.whenIdle())
          }
        }
        if (state.run !== undefined) waits.push(state.run)
      }
      await Promise.allSettled(waits)
      states.clear()
    }
  }, 'goal-round-driver lifecycle')
}

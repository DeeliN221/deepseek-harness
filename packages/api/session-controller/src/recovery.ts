/** Durable eligibility for unattended continuation; no model input grants human authority. */
import type { RecoveryState } from './types.ts'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

const candidateSchema = z.object({ endingSeq: z.number().int().nonnegative(), time: z.number(), kind: z.enum(['interrupted', 'transport']) })
const stateSchema = z.object({
  candidate: candidateSchema.nullable(),
  admitted: z.boolean(),
  protected: z.boolean(),
  goalBlocked: z.boolean(),
  humanSeq: z.number().int(),
})

/** Complete-history safety fold; a new turn retires its predecessor's recovery offer. */
export const recoveryProjectionDefinition = {
  key: 'automaticRecovery', stateVersion: 1, stateSchema,
  init: (): RecoveryState => ({ candidate: null, admitted: false, protected: false, goalBlocked: false, humanSeq: -1 }),
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return { ...state, candidate: null, admitted: false, protected: false }
      case 'user/message':
        if (event.surfaceOp !== 'append') return state
        if (event.data.source.kind === 'user') return { ...state, admitted: true, humanSeq: event.seq }
        return event.data.source.kind === 'retry' ? { ...state, admitted: true } : state
      case 'goal/change':
        return { ...state, candidate: null, goalBlocked: event.data.operation !== 'clear' && event.data.goal.phase !== 'active' }
      case 'recovery/revoked':
      case 'approval/asked':
        return { ...state, candidate: null, protected: true }
      case 'tool/call':
        return ['ask_user_question', 'request_user_input'].includes(event.data.name)
          ? { ...state, candidate: null, protected: true } : state
      case 'tool/result':
        return event.data.error?.code === 'TOOL_OUTCOME_UNKNOWN'
          ? { ...state, candidate: null, protected: true } : state
      case 'agent/inbox/spliced':
        return event.data.outcome === 'canceled' ? { ...state, candidate: null, protected: true } : state
      case 'turn/end': {
        const reason = event.data.reason
        const kind = reason.kind === 'interrupted' ? 'interrupted'
          : reason.kind === 'error' && ['TRANSPORT', 'TIMEOUT'].includes(reason.error.code)
            && (reason.error.status === undefined || reason.error.status >= 500) ? 'transport' : null
        return { ...state, candidate: kind !== null && state.admitted && !state.protected && !state.goalBlocked
          ? { endingSeq: event.seq, time: event.time, kind } : null }
      }
      default: return state
    }
  },
  wire: { viewSchema: stateSchema, view: (state: RecoveryState) => state },
} satisfies ProjectionDefinition<'automaticRecovery', RecoveryState>

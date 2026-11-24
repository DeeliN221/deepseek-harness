/** Private durable execution ownership fold for AgentRegistry. */
import type { AgentExecution } from './types.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

/** Host-only execution ownership; null denotes an unbound native or legacy Session. */
export const executionProjectionDefinition = {
  key: 'agentExecution',
  stateVersion: 1,
  stateSchema: z.enum(['llm', 'acp']).nullable(),
  init: (): AgentExecution | null => null,
  apply: (state, event) => {
    if (event.type !== 'execution/bound') return state
    if (state !== null && state !== event.data.execution) {
      throw new Error('session execution binding cannot change')
    }
    return event.data.execution
  },
} satisfies ProjectionDefinition<'agentExecution', AgentExecution | null>

import type {} from '../src/dispatch-types.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { AsyncDispatchPolicy, dispatchGuidance, dispatchProjection } from '../src/host/async-dispatch.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function harness() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const fiber = ctx.plugin(AsyncDispatchPolicy)
  await fiber
  const session = ctx.sessions.create('dispatch-one' as SessionId)
  const agent = { id: session.id, session, ctx } as Agent
  return { ctx, agent, session, fiber }
}
const input = (enabled?: boolean) => createUserMessage({
  content: [{ type: 'text', text: 'implement the change' }],
  source: { kind: 'user', rpcId: 'rpc-test' as SessionRequestId, ...(enabled === undefined ? {} : { asyncDispatch: enabled }) },
})
async function admit(ctx: Context, agent: Agent, values: (boolean | undefined)[]) {
  const messages = values.map(value => input(value))
  const decision: PreStepDecision = { kind: 'enter', messages }
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages, modelSelection: { provider: 'test', model: 'test' }, turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve(decision))
}
function currentContext(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble({ agent }).then(assembly => assembly.contexts.map(section => section.text).join('\n'))
}

describe('session async dispatch', () => {
  it('defaults off for new sessions and historical inputs; off explicitly overrides complexity routing', async () => {
    const { ctx, agent } = await harness()
    expect(ctx.sessionProjections.snapshot(agent.session).values.asyncDispatch).toBe(false)
    await admit(ctx, agent, [undefined])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: off')
    expect(dispatchGuidance(false)).toContain('overrides general instructions')
    expect(dispatchGuidance(false)).toContain('explicit instruction in the current user message')
    expect(dispatchGuidance(true)).toContain('ordinary questions and discussion do not need a task card')
    expect(dispatchGuidance(true)).toContain('Existing permissions and approval requirements remain unchanged')
  })

  it('persists selection, isolates sessions, and does not rewrite the admitted policy', async () => {
    const { ctx, agent, session } = await harness()
    const second = ctx.sessions.create('dispatch-two' as SessionId)
    const selected = await ctx.commands.execute(agent, '/async-dispatch on', [], new AbortController().signal)
    expect(selected?.result.kind).toBe('success')
    expect(ctx.sessionProjections.snapshot(session).values.asyncDispatch).toBe(true)
    expect(ctx.sessionProjections.snapshot(second).values.asyncDispatch).toBe(false)
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: off')
    await admit(ctx, agent, [true])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: on')
    await ctx.commands.execute(agent, '/async-dispatch off', [], new AbortController().signal)
    expect(ctx.sessionProjections.snapshot(session).values.asyncDispatch).toBe(false)
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: on')
    const events = session.snapshotEvents()
    const replayed = events.reduce((state, event) => dispatchProjection.apply(state, event), dispatchProjection.init())
    expect(replayed).toEqual({ selected: false, active: true })
    const cut = Math.floor(events.length / 2)
    const checkpoint = events.slice(0, cut).reduce((state, event) => dispatchProjection.apply(state, event), dispatchProjection.init())
    expect(events.slice(cut).reduce((state, event) => dispatchProjection.apply(state, event), checkpoint)).toEqual(replayed)
  })

  it('locks queue inputs independently and uses the last admitted human input in a combined step', async () => {
    const { ctx, agent } = await harness()
    await admit(ctx, agent, [true])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: on')
    await admit(ctx, agent, [])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: on')
    await admit(ctx, agent, [false])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: off')
    await admit(ctx, agent, [false, true])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: on')
    await admit(ctx, agent, [true, undefined])
    expect(await currentContext(ctx, agent)).toContain('Async dispatch: off')
  })

  it('rejects malformed selection and removes policy and command when disposed', async () => {
    const { ctx, agent, fiber } = await harness()
    expect((await ctx.commands.execute(agent, '/async-dispatch maybe', [], new AbortController().signal))?.result.kind).toBe('error')
    expect(ctx.sessionProjections.snapshot(agent.session).values.asyncDispatch).toBe(false)
    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    expect(ctx.sessionProjections.snapshot(agent.session).values.asyncDispatch).toBeUndefined()
    expect(await currentContext(ctx, agent)).not.toContain('session-dispatch-policy')
  })
})

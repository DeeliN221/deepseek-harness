import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import AgentRegistry, { AgentModel, modelSelectionProjectionDefinition, type AgentDriverProvider } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

async function harness() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  return ctx
}

const provider: AgentDriverProvider = { create: () => { throw new Error('unused constructor') } }

describe('external execution ownership', () => {
  it('reads durable ownership and retains it through replay and checkpoints', async () => {
    const ctx = await harness()
    const session = Session.create(brandString<SessionId>('execution-binding'))
    expect(ctx.agents.executionOf(session)).toBeUndefined()
    session.append('execution/bound', { execution: 'acp' })
    expect(ctx.agents.executionOf(session)).toBe('acp')
    const replay = Session.create(brandString<SessionId>('execution-replay'), session.snapshotEvents())
    expect(ctx.agents.executionOf(replay)).toBe('acp')
    expect(ctx.sessionProjections.checkpoint(session).agentExecution).toMatchObject({ val: 'acp', ver: 1 })
  })

  it('rejects duplicates and stale leases while awaiting every registered teardown', async () => {
    const ctx = await harness()
    const stopped = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    onTestFinished(() => { release.resolve(undefined) })
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      inner.agents.registerDriver('acp', provider)
    }, { inject: ['agents'] }))
    expect(() => ctx.agents.registerDriver('acp', provider)).toThrow('already registered')
    const lease = ctx.agents.acquireDriver('acp')
    const forgotten = vi.fn(async () => {})
    lease.onDispose(forgotten)()
    lease.onDispose(async () => { stopped.resolve(undefined); await release.promise })
    const disposal = owner.dispose()
    await stopped.promise
    expect(() => ctx.agents.acquireDriver('acp')).toThrow('not active')
    expect(() => lease.onDispose(async () => {})).toThrow('not active')
    expect(() => lease.create({} as never)).toThrow('not active')
    expect(forgotten).not.toHaveBeenCalled()
    release.resolve(undefined)
    await disposal
    expect(() => ctx.agents.acquireDriver('acp')).toThrow('not active')
    const unregister = ctx.agents.registerDriver('acp', provider)
    await unregister()
  })

  it('confirms external models without request headers and keeps ACP pending across native headers', async () => {
    const ctx = await harness()
    const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
    const session = Session.create(brandString<SessionId>('external-model'))
    const model = new AgentModel(projection.readerFor(session), session, {})
    const selected = { execution: 'acp' as const, provider: 'codex', model: 'gpt', displayName: 'GPT external' }
    model.select(selected)
    expect(model.current()).toEqual(selected)
    session.append('request/header', { header: { config: { provider: 'codex', model: 'gpt' } }, reason: 'initial' })
    expect(projection.stateOf(session).pending).toEqual(selected)
    session.append('execution/model-confirmed', { ...selected, displayName: 'GPT confirmed' })
    expect(projection.stateOf(session)).toEqual({ lastUsed: { ...selected, displayName: 'GPT confirmed' }, pending: null })
    const count = session.snapshotEvents().length
    model.select({ ...selected, displayName: 'Another label' })
    expect(session.snapshotEvents()).toHaveLength(count)
    const replay = Session.create(brandString<SessionId>('external-model-replay'), session.snapshotEvents())
    expect(projection.stateOf(replay)).toEqual(projection.stateOf(session))
    expect(ctx.sessionProjections.snapshot(session).values.modelSelection).toMatchObject({
      lastUsed: { execution: 'acp', displayName: 'GPT confirmed' },
    })
  })
})

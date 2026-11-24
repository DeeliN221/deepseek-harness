import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AgentModel, type Agent, type AgentDriver, type AgentDriverInput } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

function archiveDriver(input: AgentDriverInput): AgentDriver {
  const driver: AgentDriver = {
    id: input.id, options: input.options, session: input.session,
    model: new AgentModel(input.projections.modelSelection, input.session, input.options),
    get scope() { return scope },
    get ctx() { return scope.ctx },
    status: 'idle',
    get inbox(): never { throw new Error('archive has no queue') },
    send: vi.fn(), followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
    cancel: vi.fn(), whenIdle: async () => {},
    runMaintenance: task => task(new AbortController().signal),
  }
  const scope = createScope(input.ctx, driver)
  return driver
}

async function harness() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

it.each([undefined, 'llm'] as const)('leaves native session logs unbound with execution %s', async (execution) => {
  const ctx = await harness()
  const handle = await ctx.agents.create({
    sessionId: brandString<SessionId>(`native-unbound-${execution ?? 'default'}`),
    agentOptions: execution === undefined ? {} : { execution },
  })
  expect(ctx.agents.executionOf(handle.agent.session)).toBeUndefined()
  expect(handle.agent.session.snapshotEvents()).toEqual([])
  await handle.dispose()
})

it('publishes external drivers through setup and disposes them when the provider unloads', async () => {
  const ctx = await harness()
  const constructed = vi.fn(archiveDriver)
  const owner = await ctx.plugin(Object.assign((inner: Context) => {
    inner.agents.registerDriver('acp', { create: constructed })
  }, { inject: ['agents'] }))
  const setup = vi.fn((_scope: Context, agent: Agent) => {
    expect(ctx.agents.get(agent.id)).toBeUndefined()
    expect(ctx.sessions.get(agent.id)).toBe(agent.session)
    expect(ctx.agents.executionOf(agent.session)).toBe('acp')
  })
  const handle = await ctx.agents.create({
    sessionId: brandString<SessionId>('external-create'), agentOptions: { execution: 'acp' },
    setup,
  })
  expect(constructed).toHaveBeenCalledTimes(1)
  expect(setup).toHaveBeenCalledTimes(1)
  expect(handle.agent).toBe(ctx.agents.get(handle.agent.id))
  expect(handle.agent.session.snapshotEvents().map(event => event.type)).toEqual(['execution/bound'])
  await owner.dispose()
  expect(handle.agent.cancel).toHaveBeenCalledWith({ kind: 'disposed' }, { keepInbox: false })
  expect(ctx.agents.get(handle.agent.id)).toBeUndefined()
  expect(ctx.sessions.get(handle.agent.id)).toBeUndefined()
  await handle.dispose()
})

it('rolls back an external driver when setup fails and releases its provider listener', async () => {
  const ctx = await harness()
  const create = vi.fn(archiveDriver)
  const owner = await ctx.plugin(Object.assign((inner: Context) => {
    inner.agents.registerDriver('acp', { create })
  }, { inject: ['agents'] }))
  const id = brandString<SessionId>('external-setup-failure')
  await expect(ctx.agents.create({
    sessionId: id, agentOptions: { execution: 'acp' },
    setup: () => { throw new Error('setup rejected') },
  })).rejects.toThrow('setup rejected')
  const failedDriver = create.mock.results[0]!.value
  expect(failedDriver.cancel).toHaveBeenCalledWith({ kind: 'disposed' }, { keepInbox: true })
  expect(ctx.agents.get(id)).toBeUndefined()
  expect(ctx.sessions.get(id)).toBeUndefined()
  const canceled = vi.mocked(failedDriver.cancel).mock.calls.length
  await owner.dispose()
  expect(failedDriver.cancel).toHaveBeenCalledTimes(canceled)
})

it('rejects ACP creation without a provider and rejects seeded execution conflicts', async () => {
  const ctx = await harness()
  await expect(ctx.agents.create({
    sessionId: brandString<SessionId>('missing-driver'), agentOptions: { execution: 'acp' },
  })).rejects.toThrow('not active')
  const seed = Session.create(brandString<SessionId>('binding-seed'))
  seed.append('execution/bound', { execution: 'llm' })
  await expect(ctx.agents.create({
    sessionId: brandString<SessionId>('conflicting-driver'), seed: seed.snapshotEvents(), agentOptions: { execution: 'acp' },
  })).rejects.toThrow('conflicts')
})

it('resumes from durable ACP binding without replaying pending prompts and rejects legacy opt-in', async () => {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'dsh-driver-seam-'))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  const create = vi.fn(archiveDriver)
  ctx.agents.registerDriver('acp', { create })
  const id = brandString<SessionId>('external-resume')
  const first = await ctx.agents.create({ sessionId: id, agentOptions: { execution: 'acp' } })
  first.agent.session.append('execution/model-confirmed', {
    execution: 'acp', provider: 'acp:copilot', model: 'claude', displayName: 'Claude',
  })
  first.agent.session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, inserted: [createUserMessage({ content: [{ type: 'text', text: 'never resend' }], source: { kind: 'user' } })],
  })
  await first.dispose()
  await expect(ctx.agents.resume({ resumeSessionId: id, agentOptions: { execution: 'llm' } })).rejects.toThrow('conflicts')
  const resumed = await ctx.agents.resume({ resumeSessionId: id })
  expect(create).toHaveBeenCalledTimes(2)
  expect(create.mock.calls[1]![0].projections.inbox()['next-turn']).toHaveLength(1)
  expect(resumed.agent.model.current()).toEqual({
    execution: 'acp', provider: 'acp:copilot', model: 'claude', displayName: 'Claude',
  })
  expect(resumed.agent.send).not.toHaveBeenCalled()
  expect(resumed.agent.followup).not.toHaveBeenCalled()
  expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'execution/bound')).toHaveLength(1)
  await resumed.dispose()
  const legacyId = brandString<SessionId>('legacy-driver')
  const legacy = Session.create(legacyId)
  legacy.append('model/selection', { provider: 'mock', model: 'legacy' })
  const writer = await ctx.sessionPersistence.create(legacy.header)
  await writer.append(legacy.snapshotEvents())
  await writer.close()
  await expect(ctx.agents.resume({ resumeSessionId: legacyId, agentOptions: { execution: 'acp' } })).rejects.toThrow('conflicts')
  const restoredLegacy = await ctx.agents.resume({ resumeSessionId: legacyId })
  expect(ctx.agents.executionOf(restoredLegacy.agent.session)).toBeUndefined()
  expect(restoredLegacy.agent.session.snapshotEvents().some(event => event.type === 'execution/bound')).toBe(false)
  expect(restoredLegacy.agent.model.current()).toEqual({ provider: 'mock', model: 'legacy' })
  expect(create).toHaveBeenCalledTimes(2)
  await restoredLegacy.dispose()
})

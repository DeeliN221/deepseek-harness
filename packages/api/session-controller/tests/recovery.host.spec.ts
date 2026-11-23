import type { GoalId } from '@deepseek-ai/dsh-goal/types'
/** Automatic recovery admission and safety barriers over the real loop. */
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it, onTestFinished } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { continuationTurn } from '../../../client/ui-conversation/tests/continuation-fixture.ts'
import { createSessionTestRemote } from './test-remote.ts'
import { recoveryProjectionDefinition as definition } from '../src/recovery.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'

const fold = (events: readonly SessionEvent[]) => events.reduce((state, event) => definition.apply(state, event), definition.init())
const fixture = (reason: TurnEndReason) => continuationTurn(reason).map(record => record.event)

it.each(['TRANSPORT', 'TIMEOUT'])('offers only structured %s failures', (code) => {
  expect(fold(fixture({ kind: 'error', error: { code, message: code } })).candidate?.kind).toBe('transport')
})
it.each<TurnEndReason>([
  { kind: 'completed' }, { kind: 'blocked' }, { kind: 'forked' }, { kind: 'max-tokens' },
  { kind: 'aborted', reason: { kind: 'user' } }, { kind: 'aborted', reason: { kind: 'disposed' } },
  { kind: 'aborted', reason: { kind: 'legacy' } },
  { kind: 'error', error: { code: 'INVALID_REQUEST', status: 422, message: 'invalid request' } },
  { kind: 'error', error: { code: 'TRANSPORT', status: 422, message: 'misclassified invalid request' } },
  { kind: 'error', error: { code: 'INVALID_CREDENTIAL', message: 'login required' } },
])('protects $kind settlements without text heuristics', (reason) => {
  expect(fold(fixture(reason)).candidate).toBeNull()
})
it('retains checkpoint safety and rejects crash tails without admitted work', () => {
  const events = fixture({ kind: 'interrupted' })
  const state = fold(events)
  expect(state.candidate?.kind).toBe('interrupted')
  const restored = definition.stateSchema.parse(JSON.parse(JSON.stringify(fold(events.slice(0, 3)))))
  expect(events.slice(3).reduce((value, event) => definition.apply(value, event), restored)).toEqual(state)
  expect(fold(events.filter(event => event.type !== 'user/message')).candidate).toBeNull()
})
it('blocks unresolved approval and user confirmation before crash recovery', () => {
  const events = fixture({ kind: 'interrupted' })
  const prefix = events.slice(0, -1)
  const asked: SessionEvent<'approval/asked'> = { type: 'approval/asked', seq: SessionSeq(5), time: 1,
    data: { id: brandString<ApprovalRequestId>('approval'), toolName: 'write' } }
  expect(fold([...prefix, asked, events.at(-1)!]).candidate).toBeNull()
  const question: SessionEvent<'tool/call'> = { type: 'tool/call', seq: SessionSeq(5), time: 1,
    data: { turn: 1, step: 1, callId: brandString<ToolCallId>('question'), name: 'ask_user_question', arguments: '{}' } }
  expect(fold([...prefix, question, events.at(-1)!]).candidate).toBeNull()
})

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  const archivedSessionIds: SessionId[] = []
  ctx.provide('workspaceRegistry', { archivedSessionIds, list: () => [] } as never)
  const gateway: Partial<TypertGatewayService> = { getPendingRemoteEvents: () => [] }
  ctx.provide('typertGateway', gateway as TypertGatewayService)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([() => { throw new LlmError('network interrupted', 'TRANSPORT') }, textResponse('continued original task')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: '/workspace' })
  const agent = await ctx.agentLoop.create(brandString<SessionId>('automatic-recovery'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const baseline = ctx.sessionProjections.snapshot(agent.session)
  const candidate = baseline.values.automaticRecovery!.candidate!
  const request: SessionPromptRequest = { sessionId: agent.id, requestId: brandString<SessionRequestId>('recovery-once'),
    content: [], mode: 'queue', recovery: { endingSeq: candidate.endingSeq, throughSeq: baseline.asOfSeq } }
  return { ctx, agent, remote, adapter, request, archivedSessionIds }
}

it('admits once, preserves original history and records retry rather than human authority', async () => {
  const { agent, remote, adapter, request } = await setup()
  expect(await remote.prompt(request)).toEqual({ ok: true, value: { accepted: true } })
  await agent.whenIdle()
  expect(await remote.prompt(request)).toEqual({ ok: true, value: { accepted: true } })
  expect(adapter.requests).toHaveLength(2)
  const messages = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
  expect(messages.map(event => event.data.source.kind)).toEqual(['user', 'retry'])
  expect(adapter.requests[1]!.messages.filter(message => message.role === 'user').map(message => message.content))
    .toEqual([[{ type: 'text', text: 'original task' }], []])
})
it('rejects a stale cut and nonempty recovery input', async () => {
  const { remote, adapter, request } = await setup()
  expect((await remote.prompt({ ...request, recovery: { ...request.recovery!, throughSeq: 0 } })).ok).toBe(false)
  expect((await remote.prompt({ ...request, content: [{ type: 'text', text: 'continue' }] })).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
})
it('rejects a new manual stop settlement observed after the scan', async () => {
  const { agent, remote, adapter, request } = await setup()
  agent.session.append('turn/start', { turn: 2 })
  agent.session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  expect((await remote.prompt(request)).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
})

it('persists idle manual cancellation and rejects a previously sampled recovery', async () => {
  const { ctx, agent, remote, adapter, request } = await setup()
  expect((await remote.cancel({ sessionId: agent.id })).ok).toBe(true)
  expect((await remote.prompt(request)).ok).toBe(false)
  const events = agent.session.snapshotEvents()
  expect(events.at(-1)?.type).toBe('recovery/revoked')
  expect(fold(events).candidate).toBeNull()
  expect(ctx.sessionProjections.snapshot(agent.session).values.automaticRecovery?.candidate).toBeNull()
  expect(adapter.requests).toHaveLength(1)
})

it('wakes an existing queue once without an extra retry or changed per-message policy', async () => {
  const { ctx, agent, remote, adapter, request } = await setup()
  const input = createUserMessage({ content: [{ type: 'text', text: 'queued task' }],
    source: { kind: 'user', rpcId: brandString<SessionRequestId>('queued-original'), asyncDispatch: true } })
  agent.inbox.append('next-turn', input)
  const queuedRequest = { ...request, recovery: { ...request.recovery!,
    throughSeq: ctx.sessionProjections.snapshot(agent.session).asOfSeq } }
  expect((await remote.prompt(queuedRequest)).ok).toBe(true)
  await agent.whenIdle()
  expect((await remote.prompt(queuedRequest)).ok).toBe(true)
  expect(adapter.requests).toHaveLength(2)
  const messages = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
  expect(messages.map(event => event.data.source.kind)).toEqual(['user', 'user'])
  expect(messages.at(-1)!.data).toEqual(input)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'recovery/queued')).toHaveLength(1)
})

it('rejects archive admission without starting a turn', async () => {
  const { archivedSessionIds, agent, remote, adapter, request } = await setup()
  archivedSessionIds.push(agent.id)
  expect((await remote.prompt(request)).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
})

it.each(['running', 'stopping'])('rejects an owned %s background job', async (status) => {
  const { ctx, agent, remote, adapter, request } = await setup()
  ctx.provide('jobs', { list: () => [{ owner: agent.id, status }] } as never)
  expect((await remote.prompt(request)).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
})

it('serializes two recovery scans over the same existing queue', async () => {
  const { ctx, agent, remote, adapter, request } = await setup()
  agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }))
  const sampled = { ...request, recovery: { ...request.recovery!, throughSeq: ctx.sessionProjections.snapshot(agent.session).asOfSeq } }
  const results = await Promise.all([remote.prompt(sampled), remote.prompt({ ...sampled, requestId: brandString<SessionRequestId>('other-scan') })])
  await agent.whenIdle()
  expect(results.filter(result => result.ok)).toHaveLength(1)
  expect(adapter.requests).toHaveLength(2)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'recovery/queued')).toHaveLength(1)
})

it('re-drives a durable queued receipt after a crash before wake without inserting another receipt', async () => {
  const { ctx, agent, remote, adapter, request } = await setup()
  agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'retained queue' }], source: { kind: 'user' } }))
  agent.session.append('recovery/queued', { requestId: request.requestId, endingSeq: request.recovery!.endingSeq })
  const sampled = { ...request, recovery: { ...request.recovery!, throughSeq: ctx.sessionProjections.snapshot(agent.session).asOfSeq - 1 } }
  expect((await remote.prompt(sampled)).ok).toBe(true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'recovery/queued')).toHaveLength(1)
})

it.each(['paused', 'complete', 'blocked'] as const)('protects a %s goal across interrupted turns', (phase) => {
  const events = fixture({ kind: 'interrupted' })
  const changed: SessionEvent<'goal/change'> = { type: 'goal/change', seq: SessionSeq(5), time: 1,
    data: { kind: 'goal/change', version: 1, operation: phase === 'paused' ? 'pause' : phase === 'complete' ? 'complete' : 'block',
      goal: { id: brandString<GoalId>('protected-goal'), revision: 2, objective: 'original task', phase, maxGoalRounds: 5 },
      roundsStarted: 1, createdAt: 0, updatedAt: 1 } }
  expect(fold([...events.slice(0, -1), changed, events.at(-1)!]).candidate).toBeNull()
})

it('fails closed for an Agent provider without native queue wake', async () => {
  const { ctx, agent, remote, adapter, request } = await setup()
  agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'retained queue' }], source: { kind: 'user' } }))
  Object.defineProperty(agent, 'resumePending', { value: undefined })
  const sampled = { ...request, recovery: { ...request.recovery!, throughSeq: ctx.sessionProjections.snapshot(agent.session).asOfSeq } }
  expect((await remote.prompt(sampled)).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
  expect(agent.inbox.nextTurn).toHaveLength(1)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'recovery/queued')).toHaveLength(0)
})

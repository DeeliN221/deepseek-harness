import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { agentEvents, type AgentDriverProvider, type AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope } from '@deepseek-ai/dsh-scope'
import { AssistantStreamAccumulator, BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, type SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

type ExternalEvent = { id: string; type: string; data: Record<string, unknown> }

const driverSource = process.env['DSH_ACP_DRIVER_SOURCE']

it.skipIf(driverSource === undefined)('persists real ACP driver output and restores it as an archive without replaying prompts', async () => {
  const modulePath = driverSource!
  const { createAcpDriverProvider } = await import(modulePath) as {
    createAcpDriverProvider(dependencies: Record<string, unknown>): AgentDriverProvider
  }
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'dsh-real-acp-driver-'))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  const id = brandString<SessionId>('real-external-driver')
  const binding = { id: 'external', dshSessionId: id, engine: 'copilot', modelId: 'claude', displayName: 'Claude', userId: 'owner', device: 'nas', state: 'idle' }
  let activeBinding: typeof binding | undefined = binding
  let listener: ((event: ExternalEvent) => void) | undefined
  let hang = false
  const hangingStarted = Promise.withResolvers<undefined>()
  const cancel = vi.fn(async () => {
    listener?.({ id: binding.id, type: 'turn_finished', data: { stopReason: 'cancelled' } })
  })
  const prompt = vi.fn(async () => {
    listener?.({ id: binding.id, type: 'session_update', data: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } } })
    listener?.({ id: binding.id, type: 'session_update', data: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } } })
    if (hang) hangingStarted.resolve(undefined)
    else listener?.({ id: binding.id, type: 'turn_finished', data: { stopReason: 'end_turn' } })
  })
  const provider = createAcpDriverProvider({
    lookupBinding: () => activeBinding,
    subscribe: (_binding: unknown, receive: (event: ExternalEvent) => void) => {
      listener = receive
      return () => { listener = undefined }
    },
    manager: { prompt, waitForTurn: async () => {}, cancel },
    runtime: { createScope, agentEvents, AssistantStreamAccumulator, BlockAssembler, createAssistantMessage, appendPluginRecord },
  })
  ctx.agents.registerDriver('acp', provider)
  const frames: AssistantStreamFrame[] = []
  ctx.on('agent/assistant-stream', ({ frame }) => { frames.push(frame) })
  const first = await ctx.agents.create({
    sessionId: id, agentOptions: { execution: 'acp', provider: 'acp:copilot', model: 'claude' },
    setup: (_agentCtx, agent) => { agent.session.append('execution/model-confirmed', { execution: 'acp', provider: 'acp:copilot', model: 'claude', displayName: 'Claude' }) },
  })
  first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
  await first.agent.whenIdle()
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(listener).toBeUndefined()
  expect(frames.map(frame => frame.revision)).toEqual(frames.map((_frame, index) => index + 1))
  hang = true
  first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cancel this' }], source: { kind: 'user' } }))
  await hangingStarted.promise
  first.agent.cancel({ kind: 'user' })
  await first.agent.whenIdle()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(prompt).toHaveBeenCalledTimes(2)
  expect(listener).toBeUndefined()
  const events = first.agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'assistant/message').at(-1)?.data.interrupted).toBe(true)
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  expect(events.some(event => event.type === 'request/header')).toBe(false)
  const message = events.find(event => event.type === 'assistant/message')
  expect(message?.data.message.content).toEqual([{ type: 'reasoning', text: 'Thinking' }, { type: 'text', text: 'Hello' }])
  expect(frames.at(-1)).toMatchObject({ type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message', seq: events.filter(event => event.type === 'assistant/message').at(-1)?.seq } })
  await first.dispose()
  activeBinding = undefined
  const resumed = await ctx.agents.resume({ resumeSessionId: id })
  expect(resumed.agent.model.current()).toMatchObject({ execution: 'acp', displayName: 'Claude' })
  expect(() => resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do not replay' }], source: { kind: 'user' } }))).toThrow('readonly archive')
  expect(prompt).toHaveBeenCalledTimes(2)
  const restored = resumed.agent.session.snapshotEvents()
  expect(restored.slice(0, events.length)).toEqual(events)
  expect(restored.slice(events.length).map(event => event.type)).toEqual(['session/end-seed'])
  await resumed.dispose()
})

import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { AsyncDispatchPolicy } from '../src/host/async-dispatch.ts'

function waitIdle(ctx: Context, agent: Agent) {
  return new Promise<void>((resolve) => {
    const off = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { off(); resolve() }
    })
  })
}
function policy(request: GenerateOptions | undefined) {
  const text = request?.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n') ?? ''
  return [...text.matchAll(/Async dispatch: (on|off)/gu)].at(-1)?.[1]
}
it('feeds captured policy into real model requests, freezes running work, and defaults a later non-Web input off', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AsyncDispatchPolicy)
  const adapter = new MockAdapter([toolCallResponse('probe-call', 'probe', {}), textResponse('done'), textResponse('direct')])
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'probe', description: 'test tool', parameters: {},
    execute: async () => {
      await ctx.commands.execute(agent, '/async-dispatch off', [], new AbortController().signal)
      return [{ type: 'text', text: 'continued existing work' }]
    },
  }))
  const agent = await ctx.agentLoop.create('dispatch-loop' as SessionId, { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'implement' }],
    source: { kind: 'user', rpcId: 'loop-one' as SessionRequestId, asyncDispatch: true } }))
  await waitIdle(ctx, agent)
  expect(adapter.requests).toHaveLength(2)
  expect(adapter.requests.map(policy)).toEqual(['on', 'on'])
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'another task' }], source: { kind: 'user' } }))
  await waitIdle(ctx, agent)
  expect(policy(adapter.requests[2])).toBe('off')
})

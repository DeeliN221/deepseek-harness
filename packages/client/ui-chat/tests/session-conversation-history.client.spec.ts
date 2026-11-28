import { Context } from '@deepseek-ai/cordis'
import { onTestFinished, expect } from 'vitest'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { createScope, type ISessions, type SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createClientTest, webApp } from '../../../test-support/client-runtime/src/assembly/index.ts'
import { ev } from '../../../api/session-controller/tests/event-script.client.ts'
import { sessionBench } from '../../../api/session-controller/tests/remote/bench.client.ts'
import { FOLLOW, followScript, history, pageRule } from '../../../api/session-controller/tests/remote/session.client.ts'
import { messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-gateway']) })
const sessionId = 'history-integration' as SessionId

it('publishes every loaded user message in order after expanding local history', async ({ mock, start }) => {
  const events = Array.from({ length: 29 }, (_, turn) => {
    const seq = turn * 8
    const call = `call-${turn}`
    return [
      ev.turnStart(SessionSeq(seq), turn), ev.user(SessionSeq(seq + 1), `prompt-${turn}`),
      ev.stepStart(SessionSeq(seq + 2), turn), ev.toolCall(SessionSeq(seq + 3), turn, call, 'test', '{}'),
      ev.toolResult(SessionSeq(seq + 4), turn, call, 'result'), ev.assistant(SessionSeq(seq + 5), turn, `answer-${turn}`),
      ev.stepEnd(SessionSeq(seq + 6), turn), ev.turnEnd(SessionSeq(seq + 7), turn),
    ]
  }).flat()
  const session = await sessionBench(mock, start, sessionId)
  mock.stream(FOLLOW, followScript(history(events.slice(192), true)))
  mock.remote.session.page.mockImplementation(pageRule(request => {
    const end = request.beforeSeq
    if (end === undefined) throw new Error('Expected an exclusive history cursor')
    const start = Math.max(0, end - 32)
    return history(events.slice(start, end), start > 0)
  }))

  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const scope = createScope(ctx, sessionId)
  const binding: SessionBinding = { sessionId, session, eventSource: session.eventSource, ctx: scope.ctx }
  const sessions = { binding: (id: SessionId) => id === sessionId ? binding : undefined } as ISessions
  const conversation = new UiConversation(ctx, sessions)
  conversation.events.register(messageDefinition)
  conversation.events.register(assistantDefinition)
  conversation.events.register(toolDefinition)
  conversation.views.register(chatViewDefinition)
  const bound = conversation.binding(binding)
  bound.activate('chat')
  await session.open()

  const chatRows = (): string[] => {
    const chat = bound.target('chat').getSnapshot()
    if (chat === undefined) throw new Error('Chat view was not published')
    return chat.order.flatMap(key => {
      const node = chat.nodes.get(key)
      return node !== undefined && ['user', 'assistant-step', 'tool-call'].includes(node.kind)
        ? [`${node.kind}:${node.anchorSeq}`] : []
    })
  }
  const assertLoadedRows = (): void => {
    const loaded = session.eventSource.getSnapshot().entries
    const expected = loaded.flatMap(({ event }) => {
      if (event.type === 'user/message') return [`user:${event.seq}`]
      if (event.type === 'assistant/message') return [`assistant-step:${event.seq}`]
      if (event.type === 'tool/call') return [`tool-call:${event.seq}`]
      return []
    })
    const actual = chatRows()
    expect(new Set(actual).size).toBe(actual.length)
    expect(actual).toEqual(expected)
  }
  assertLoadedRows()

  let pages = 0
  while (session.getSnapshot().hasMore) {
    await session.loadOlder({ deferConsumption: true })
    expect(session.getSnapshot().historyLoadStatus).toBe('pendingConsumption')
    expect(session.consumeOlder()).toBe(true)
    assertLoadedRows()
    pages++
  }
  expect(pages).toBe(6)
  expect(session.eventSource.getSnapshot().entries.map(entry => entry.event.seq))
    .toEqual(events.map(event => event.seq))
  const window = bound.snapshot.getSnapshot().historyWindow
  expect(window).toBeDefined()
  let expansions = 0
  while (window?.pending && expansions < 30) {
    expect(window.expandOlder()).toBe(true)
    expansions++
  }
  expect(window?.pending).toBe(false)
  assertLoadedRows()
}, 60_000)

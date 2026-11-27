// @vitest-environment jsdom
import { Suspense, startTransition, useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatViewSlotProps, UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ChatView } from '../src/client/chat/ChatView.tsx'
import { zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'
import { installTurnNavigatorObserver } from './turn-navigator-fixture.ts'

type Position = ReturnType<ChatViewSlotProps['chatScroll']['read']>
type PageResult = NonNullable<SessionSnapshot['historyPageResult']>

const user = (seq: number): UserMessageNode => ({
  kind: 'user', seq, time: seq * 1_000,
  content: [{ type: 'text', text: `message ${seq}` }] as never, source: null,
})

/** Minimal independent Session bindings; ChatView and its scrolling hooks are real. */
function createSession(id: 'A' | 'B', first: number, pageId: number, pending: boolean) {
  const initial = Array.from({ length: 320 }, (_, index) => user(first + index))
  const chat = createSnapshotStore(chatSnapshotFixture({ nodes: initial }))
  const conversation = createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT)
  const session = createSnapshotStore<SessionSnapshot>({
    sessionId: id as SessionId, pendingSubmissions: [], running: false, removed: false,
    openState: 'open', openError: null, hasMore: true, loadingOlder: pending,
    historyLoadStatus: pending ? 'loading' : 'idle', historyWasPartial: true,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    promptAttempted: true, awaitingFirstTurn: false,
    ...(pending ? { historyPageId: pageId, historyPageResult: 'pending' as const,
      historyPageResults: new Map([[pageId, 'pending' as const]]) } : {}),
  })
  let position: Position = { anchorKey: `fixture:user:${first + 100}`, anchorTop: 100, scrollTop: 1_900 }
  let shift = 0
  const loadOlder = vi.fn(() => {
    const old = session.getSnapshot()
    session.set({ ...old, loadingOlder: true, historyLoadStatus: 'loading', historyPageId: pageId,
      historyPageResult: 'pending', historyPageResults: new Map([[pageId, 'pending']]) })
  })
  const useSession = bindSnapshotSelector(session)
  const useChat = bindSnapshotSelector(chat)
  const useConversation = bindSnapshotSelector(conversation)
  const sessionList = bindSnapshotSelector(createSnapshotStore({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }))
  const filePathBase = bindSnapshotSelector(createSnapshotStore<unknown>(undefined))
  const interactionIds = bindSnapshotSelector(createSnapshotStore<readonly string[]>([]))
  const presentation = bindSnapshotSelector(createSnapshotStore({ mode: 'standard', collapseTiming: 'completion' }))
  const scroll: ChatViewSlotProps['chatScroll'] = {
    read: () => position,
    save: value => { position = value },
  }
  const pageState = () => {
    const snapshot = session.getSnapshot()
    return snapshot.historyPageId === undefined || snapshot.historyPageResult === undefined
      ? undefined : { id: snapshot.historyPageId, result: snapshot.historyPageResult }
  }
  const props = {
    sessionId: id as SessionId, useSession, useChat, useConversation, useSessions: sessionList,
    useContextMenu: contextMenuHook(), usePresentation: presentation,
    useProjection: () => undefined, useFilePathBase: filePathBase, useInteractionIds: interactionIds,
    dispatchInteraction: () => null, fileDrag: {}, useResource: () => ({ status: 'none', value: undefined }),
    resolveFilePath: (path: string) => path, openFile: async () => {}, openExternalLink: () => {},
    loadOlder, historyPageId: () => pageState()?.result === 'pending' ? pageId : undefined,
    historyPageState: pageState,
    historyPageConsumed: (candidate: number) => session.getSnapshot().historyPageResults?.get(candidate) === 'consumed',
    consumeOlder: () => false, loadThrough: async () => {}, loadImage: async () => '',
    inspectCall: () => {}, forkAt: () => {}, chatScroll: scroll, t: makeTranslate(zh, commonZh),
  } as ChatViewSlotProps

  return {
    id, first, props, loadOlder, scroll,
    shift: () => shift,
    /** Model Session's consumed-before-Chat publication and the later Conversation acknowledgement. */
    commitPage() {
      const old = session.getSnapshot()
      session.set({ ...old, loadingOlder: false, historyLoadStatus: 'idle', historyPageId: pageId,
        historyPageResult: 'consumed', historyPageResults: new Map<number, PageResult>([[pageId, 'consumed']]) })
      shift = 600
      chat.set(chatSnapshotFixture({ nodes: [
        ...Array.from({ length: 30 }, (_, index) => user(first - 30 + index)), ...initial,
      ] }, chat.getSnapshot()))
      conversation.set({ ...conversation.getSnapshot(), historyPageIds: [pageId] })
    },
  }
}

function installMetrics(host: HTMLElement) {
  let top = 0
  Object.defineProperties(host, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 8_000 },
    scrollTop: { configurable: true, get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, 7_800)) } },
  })
}

function readerScroll(host: HTMLElement, top: number) {
  fireEvent.wheel(host)
  host.scrollTop = top
  fireEvent.scroll(host)
  fireEvent(host, new Event('scrollend'))
}

async function historyFrame() {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
}

beforeEach(() => {
  localStorage.clear()
  installTurnNavigatorObserver()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatView suspended Session transition', () => {
  it.each(['scroll', 'cancel'] as const)(
    'keeps each Session anchor when the old view receives %s while the new view suspends', async action => {
      const a = createSession('A', 1, 101, false)
      const b = createSession('B', 1_001, 202, true)
      let release!: () => void
      let suspended = true
      let attempts = 0
      const gate = new Promise<void>(resolve => { release = () => { suspended = false; resolve() } })
      const SuspendAfterChatRender = () => {
        if (suspended) { attempts++; throw gate }
        return null
      }
      let select!: (next: 'A' | 'B') => void
      const makeProps = (target: typeof a): ChatViewSlotProps => ({
        ...target.props,
        renderSlot: ((name: string, owner: { visibleOrder?: readonly string[] }, options?: { children?: React.ReactNode }) => {
          if (name === 'conversation.chat.markdown.fence') return options?.children ?? null
          if (name !== 'conversation.chat.flow') return null
          return <>
            {(owner.visibleOrder ?? []).map(key => {
              const seq = Number(key.split(':').at(-1))
              return <div key={key} data-chat-flow-key={key} data-chat-node-key={key}
                data-chat-anchor-key={key} data-test-seq={seq} data-test-session={target.id}>{`${target.id}:${seq}`}</div>
            })}
            {target.id === 'B' && <SuspendAfterChatRender />}
          </>
        }) as ChatViewSlotProps['renderSlot'],
      })
      const aProps = makeProps(a)
      const bProps = makeProps(b)
      function App() {
        const [current, setCurrent] = useState<'A' | 'B'>('A')
        select = setCurrent
        return <Suspense fallback={<div>loading new Session</div>}>
          <ChatView {...(current === 'A' ? aProps : bProps)} />
        </Suspense>
      }
      const host = document.createElement('div')
      host.dataset.conversationScroll = ''
      document.body.append(host)
      installMetrics(host)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === host) return new DOMRect(0, 0, 500, 200)
        const target = this.dataset.testSession === 'A' ? a : b
        const seq = Number(this.dataset.testSeq)
        if (Number.isFinite(seq)) {
          const priorPage = seq < target.first
          const top = (seq - target.first) * 20 + target.shift() - host.scrollTop
          return new DOMRect(0, priorPage ? top - target.shift() : top, 500, 20)
        }
        return new DOMRect(0, 0, 500, 200)
      })
      let hit: HTMLElement | null = null
      const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit === null ? [] : [hit] })
      try {
        const view = render(<App />, { container: host })
        expect(host.querySelector('[data-test-session="A"]')).not.toBeNull()
        await act(async () => { startTransition(() => select('B')) })
        await waitFor(() => { expect(attempts).toBeGreaterThan(0) })
        // The gate is inside B's flow: ChatView B has rendered, but A must remain committed and usable.
        expect(host.querySelector('[data-test-session="A"]')).not.toBeNull()
        expect(host.querySelector('[data-test-session="B"]')).toBeNull()
        expect(view.queryByText('loading new Session')).toBeNull()

        hit = host.querySelector<HTMLElement>('[data-chat-node-key="fixture:user:121"]')
        expect(hit).not.toBeNull()
        readerScroll(host, 2_300)
        expect(a.scroll.read()?.anchorKey).toBe('fixture:user:121')
        expect(b.scroll.read()?.anchorKey).toBe('fixture:user:1101')

        // An A-owned action during the suspended B render must not use B's render-control ref.
        // The first clicks can reveal already loaded local slices before a remote request.
        for (let step = 0; step < 8 && a.loadOlder.mock.calls.length === 0; step++) {
          fireEvent.click(host.querySelector<HTMLButtonElement>('[data-chat-history] button')!)
          await historyFrame()
        }
        expect(a.loadOlder).toHaveBeenCalledOnce()
        expect(b.loadOlder).not.toHaveBeenCalled()
        if (action === 'cancel') {
          fireEvent.click(view.getByLabelText('回到底部'))
          expect(a.scroll.read()).toBeNull()
        }
        const expectedA = a.scroll.read()

        await act(async () => { release(); await gate })
        await waitFor(() => { expect(host.querySelector('[data-test-session="B"]')).not.toBeNull() })
        const bAnchor = host.querySelector<HTMLElement>('[data-chat-node-key="fixture:user:1101"]')
        expect(bAnchor).not.toBeNull()
        expect(b.scroll.read()?.anchorKey).toBe('fixture:user:1101')
        expect(bAnchor!.getBoundingClientRect().top).toBe(100)
        expect(a.scroll.read()).toEqual(expectedA)

        // B's already pending page is published after the transition commits.
        act(() => { b.commitPage() })
        expect(host.querySelector('[data-chat-node-key="fixture:user:1101"]')).not.toBeNull()
        expect(b.scroll.read()?.anchorKey).toBe('fixture:user:1101')
        expect(host.querySelector<HTMLElement>('[data-chat-node-key="fixture:user:1101"]')!.getBoundingClientRect().top).toBe(100)
        expect(a.scroll.read()).toEqual(expectedA)

        await act(async () => { startTransition(() => select('A')) })
        await waitFor(() => { expect(host.querySelector('[data-test-session="A"]')).not.toBeNull() })
        if (action === 'cancel') {
          expect(a.scroll.read()).toBeNull()
          expect(host.scrollTop).toBe(7_800)
        } else {
          expect(a.scroll.read()?.anchorKey).toBe('fixture:user:121')
          expect(host.querySelector<HTMLElement>('[data-chat-node-key="fixture:user:121"]')!.getBoundingClientRect().top).toBe(100)
        }
        expect(b.scroll.read()?.anchorKey).toBe('fixture:user:1101')
      } finally {
        if (originalHitTest === undefined) Reflect.deleteProperty(document, 'elementsFromPoint')
        else Object.defineProperty(document, 'elementsFromPoint', originalHitTest)
        host.remove()
      }
    }, 20_000,
  )
})

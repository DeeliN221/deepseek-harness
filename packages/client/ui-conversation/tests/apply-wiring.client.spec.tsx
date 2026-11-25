// @vitest-environment jsdom
import { apply as applyMenus, inject as injectMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { describe, expect, it, vi } from 'vitest'
import {
  SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, type ViewTab } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSettings, ViewTabSelection } from '../src/submission-settings.ts'

usePinnedBrowserLanguages('zh-CN')

const SID = 'session-1' as SessionId

async function bench(options: { declareConversation?: boolean } = {}) {
  const runtime = await SlotTestRuntime.create()
  const developerTools = createSnapshotStore(true)
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: vi.fn(async (_workspaceId: unknown, beforeOpen: (id: SessionId) => void) => {
      beforeOpen(SID)
    }),
    openSession: vi.fn(),
  } as never)
  const settingsForm = stubConfigForm<ConversationSettings>()
  runtime.ctx.provide('configForms', { developerTools: { enabled: developerTools }, get: () => settingsForm.scope } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
  await runtime.mount({ inject: [...injectMenus], apply: applyMenus })
  if (options.declareConversation !== false) {
    await runtime.root.declare({
      'main': { kind: 'keyed', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    }, (_props: { renderSlot?: unknown }) => null)
  }
  const feature = await runtime.mount({ inject: [...inject], apply })
  if (options.declareConversation !== false) runtime.renderRoot()
  return { runtime, feature, developerTools, settingsForm }
}

function entry(
  runtime: SlotTestRuntime,
  key: 'main.conversation' | 'conversation.session' | 'conversation.session.header',
) {
  return runtime.slots.entries(key)[0] as { store?: unknown } | undefined
}

describe('target-neutral Conversation apply wiring', () => {
  it('contributes async dispatch only during the model-menu declaration lifetime', async () => {
    const b = await bench()
    expect(b.runtime.slots.entries('conversation.input.model.options')).toHaveLength(0)
    const declare = () => b.runtime.slots.register({
      name: 'conversation.input.model',
      children: { 'conversation.input.model.options': { kind: 'list', scope: 'session' } },
    }, ({ renderSlot }: PropsRenderSlots<'conversation.input.model.options'>) => renderSlot('conversation.input.model.options', {
      locked: false, dismiss: vi.fn(), reportFailure: vi.fn(), openPane: vi.fn(),
    }))
    const dispose = declare()
    expect(b.runtime.slots.entries('conversation.input.model.options').map(row => row.options.id)).toEqual(['async-dispatch'])
    dispose()
    expect(b.runtime.slots.entries('conversation.input.model.options')).toHaveLength(0)
    declare()
    expect(b.runtime.slots.entries('conversation.input.model.options')).toHaveLength(1)
    await b.feature.dispose()
    expect(b.runtime.slots.entries('conversation.input.model.options')).toHaveLength(0)
    await b.runtime.dispose()
  })
  it('hands every Session header the same profile View tab order and the settings row writes it', async () => {
    const b = await bench()
    b.runtime.slots.register({ name: 'conversation.view', id: 'trajectory', label: 'Trajectory' }, (() => null) as never)
    b.runtime.slots.register({ name: 'conversation.view', id: 'chat', label: 'Chat' }, (() => null) as never)
    const header = b.runtime.slots.entries('conversation.session.header')[0]!
    type PreferenceHooks = { hooks: { viewTabs: ObservableSnapshot<ViewTabSelection> } }
    const inject = header.inject as (sessionId: SessionId) => PreferenceHooks
    const injected = inject(SID)
    const order = injected.hooks.viewTabs
    expect(order.getSnapshot()).toBeNull()
    expect(inject('session-2' as SessionId).hooks.viewTabs).toBe(order)
    b.settingsForm.publish({
      status: 'ready',
      value: { busyEnter: 'queue', viewTabs: ['trajectory'] },
    })
    expect(order.getSnapshot()).toEqual(['trajectory'])
    const settingsRow = b.runtime.slots.entries('settings.general.item')
      .find(row => row.options.id === 'conversation-view-tabs')!
    const rowInject = settingsRow.inject as () => { setViewTabs: (ids: readonly string[]) => void }
    rowInject().setViewTabs(['trajectory', 'context'])
    expect(b.settingsForm.set).toHaveBeenCalledExactlyOnceWith('viewTabs', ['trajectory', 'context'])
    await b.runtime.dispose()
  })

  it('hides only the Trajectory View while developer tools are disabled and restores it when enabled', async () => {
    const b = await bench()
    const header = b.runtime.slots.entries('conversation.session.header')[0]!
    const source = (header.inject!() as { hooks: { conversationViews: ObservableSnapshot<readonly ViewTab[]> } }).hooks.conversationViews
    for (const id of ['chat', 'trajectory', 'probe']) {
      b.runtime.slots.register({ name: 'conversation.view', id, label: id }, (() => null) as never)
    }
    await vi.waitFor(() => { expect(source.getSnapshot().map(tab => tab.id)).toEqual(['chat', 'trajectory', 'probe']) })
    b.developerTools.set(false)
    expect(source.getSnapshot().map(tab => tab.id)).toEqual(['chat', 'probe'])
    b.developerTools.set(true)
    expect(source.getSnapshot().map(tab => tab.id)).toEqual(['chat', 'trajectory', 'probe'])
    await b.runtime.dispose()
  })
  it('waits for the layout-owned conversation declaration before registering its subtree', async () => {
    const b = await bench({ declareConversation: false })
    expect(b.runtime.slots.entries('main')).toHaveLength(0)
    expect(b.runtime.slots.entries('main.conversation')).toHaveLength(0)

    await b.runtime.root.declare({
      'main': { kind: 'keyed', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    }, (_props: { renderSlot?: unknown }) => null)
    b.runtime.renderRoot()
    expect(b.runtime.slots.entries('main').map(row => row.options.key)).toEqual(['conversation'])
    expect(b.runtime.slots.entries('main.conversation')).toHaveLength(1)
    expect(b.runtime.slots.spec('main.conversation'))
      .toEqual({ kind: 'single', scope: 'session-maybe' })
    expect(b.runtime.factoryOf('conversation.content').slots)
      .toMatchObject({ views: { scope: 'session' } })
    expect(b.runtime.slots.entries('conversation.session')).toHaveLength(1)
    expect(b.runtime.slots.entries('conversation.session.header')).toHaveLength(1)
    expect(b.runtime.slots.spec('conversation.header')).toEqual({ kind: 'single', scope: 'session-maybe' })
    expect(b.runtime.slots.spec('conversation.header.leading')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.runtime.slots.entries('conversation.composer.bar')).toHaveLength(1)
    await b.runtime.dispose()
  })

  it('provides both action and assembly services without installing Chat', async () => {
    const b = await bench()
    expect(b.runtime.ctx.get('conversation')).toBeDefined()
    expect(b.runtime.ctx.get('uiConversation')).toBeDefined()
    expect(b.runtime.slots.entries('conversation.view')).toHaveLength(0)
    await b.runtime.dispose()
  })

  it('owns shell slots and shares only the Conversation store', async () => {
    const b = await bench()
    const session = entry(b.runtime, 'conversation.session')
    const header = entry(b.runtime, 'conversation.session.header')
    expect(entry(b.runtime, 'main.conversation')?.store).toBeUndefined()
    expect(b.runtime.factoryOf('conversation.content').store).toBeUndefined()
    expect(session?.store).toBeDefined()
    expect(header?.store).toBe(session?.store)
    expect(b.runtime.slots.spec('conversation.composer'))
      .toEqual({ kind: 'chain', scope: 'session' })
    expect(b.runtime.slots.entries('settings.general.item').map(row => row.options.id))
      .toEqual(['composer-enter', 'conversation-view-tabs'])
    await b.runtime.dispose()
  })

  it('binds a cached locale-aware View roster only to its shell entries', async () => {
    const b = await bench()
    await b.runtime.sessions.add({ id: SID })
    using reference = b.runtime.sessions.retain(SID)
    expect(b.runtime.ctx.uiSession.adapter.bindingSource(reference).getSnapshot().hooks.conversationViews).toBeUndefined()
    const header = b.runtime.slots.entries('conversation.session.header')[0]
    const source = (header?.inject?.() as {
      hooks: { conversationViews: ObservableSnapshot<readonly ViewTab[]> }
    } | undefined)?.hooks.conversationViews
    expect(source).toBeDefined()
    expect(source?.getSnapshot()).toBe(source?.getSnapshot())

    const disposeView = b.runtime.slots.register({
      name: 'conversation.view',
      id: 'probe',
      label: () => b.runtime.ctx.locale.getSnapshot().active,
    }, (() => null) as never)
    await vi.waitFor(() => {
      expect(source?.getSnapshot()).toEqual([{ id: 'probe', label: 'zh' }])
    })
    const chinese = source?.getSnapshot()

    b.runtime.ctx.locale.setLocale('en')
    expect(source?.getSnapshot()).toEqual([{ id: 'probe', label: 'en' }])
    expect(source?.getSnapshot()).not.toBe(chinese)

    disposeView()
    await vi.waitFor(() => { expect(source?.getSnapshot()).toEqual([]) })
    await b.runtime.dispose()
  })

  it('removes services, entries, and declarations with the plugin fiber', async () => {
    const b = await bench()
    await b.feature.dispose()
    expect(b.runtime.ctx.get('conversation')).toBeUndefined()
    expect(b.runtime.ctx.get('uiConversation')).toBeUndefined()
    expect(b.runtime.slots.entries('main')).toHaveLength(0)
    expect(b.runtime.slots.entries('main.conversation')).toHaveLength(0)
    expect(b.runtime.slots.spec('main.conversation')).toBeUndefined()
    expect(b.runtime.slots.spec('conversation.view')).toBeUndefined()
    await b.runtime.dispose()
  })
})

// @vitest-environment jsdom
/** The plugin fills the left sidebar's More menu with discovery and Creator actions only. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { EntryMenuContent } from '../src/client/EntryMenuContent.tsx'
import { en } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  try { for (const runtime of runtimes) await runtime.dispose() }
  finally { runtimes.clear(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() }
})

type ContentProps = ComponentProps<typeof EntryMenuContent>
const unused = (): never => { throw new Error('The menu rows read no framework hooks') }

function content(overrides: Partial<ContentProps> = {}) {
  const callbacks = {
    onOpen: vi.fn<ContentProps['onOpen']>(), onPinnedChange: vi.fn<ContentProps['onPinnedChange']>(),
    onDismiss: vi.fn<ContentProps['onDismiss']>(), browsePlugins: vi.fn<ContentProps['browsePlugins']>(),
    createPlugin: vi.fn<ContentProps['createPlugin']>(),
  }
  const props = {
    entries: [{ id: 'notes', label: 'Notes', pinned: true }, { id: 'tasks', label: 'Tasks', pinned: false }],
    region: 'sidebar', t: makeTranslate(en),
    usePluginNavigation: <T,>(select: (present: boolean) => T): T => select(true),
    usePanelInfo: unused, useSessions: unused, useSessionStatus: unused, useSessionRetainInfo: unused,
    useResource: unused, useWorkspaces: unused, renderFactorySlot: () => null,
    ...callbacks,
    ...overrides,
  } as ContentProps
  const view = render(<div role="menu"><EntryMenuContent {...props} /></div>)
  return { view, props, ...callbacks }
}

describe('More menu rows', () => {
  it.each(['rightbar'] as const)('shows only discovery and creation in %s regardless of entries', (region) => {
    const b = content({ region, entries: [
      { id: 'notes', label: 'Notes', pinned: true, active: true },
      { id: 'tasks', label: 'Tasks', pinned: false },
    ] })
    expect(b.view.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['Browse other plugins', 'Create your plugin'])
    expect(b.view.queryByRole('separator')).toBeNull()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Browse other plugins' }))
    expect(b.browsePlugins).toHaveBeenCalledExactlyOnceWith()
    expect(b.onDismiss.mock.invocationCallOrder[0]).toBeLessThan(b.browsePlugins.mock.invocationCallOrder[0]!)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Create your plugin' }))
    expect(b.createPlugin).toHaveBeenCalledExactlyOnceWith()
    expect(b.onDismiss.mock.invocationCallOrder[1]).toBeLessThan(b.createPlugin.mock.invocationCallOrder[0]!)
    expect(b.onOpen).not.toHaveBeenCalled()
    expect(b.onPinnedChange).not.toHaveBeenCalled()
  })

  it('lists only unpinned sidebar entries and pins without navigating', () => {
    const b = content()
    expect(b.view.queryByRole('menuitem', { name: 'Notes' })).toBeNull()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Tasks' }))
    expect(b.onOpen).toHaveBeenCalledExactlyOnceWith('tasks')
    expect(b.onPinnedChange).not.toHaveBeenCalled()
    b.onOpen.mockClear()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Pin Tasks to sidebar' }))
    expect(b.onPinnedChange).toHaveBeenCalledExactlyOnceWith('tasks', true)
    expect(b.onOpen).not.toHaveBeenCalled()
  })

  it('returns focus to More after keyboard pinning without opening the entry', async () => {
    const b = content()
    b.view.unmount()
    function PinMenu() {
      const [open, setOpen] = useState(true)
      return <Menu open={open} onClose={() => { setOpen(false) }} autoFocus
        anchor={<button type="button">More</button>}>
        <EntryMenuContent {...b.props} onDismiss={() => { setOpen(false) }} />
      </Menu>
    }
    const view = render(<PinMenu />)
    const pin = view.getByRole('menuitem', { name: 'Pin Tasks to sidebar' })
    act(() => { pin.focus() })
    fireEvent.keyDown(pin, { key: 'Tab' })
    await waitFor(() => { expect(document.activeElement).toBe(view.getByRole('button', { name: 'More' })) })
    expect(b.onPinnedChange).toHaveBeenCalledExactlyOnceWith('tasks', true)
    expect(b.onOpen).not.toHaveBeenCalled()
  })

  it.each([true, false])('opens folded Views and marks the active View with plugin navigation present=%s', (browsable) => {
    const b = content({ region: 'conversation',
      usePluginNavigation: select => select(browsable),
      entries: [
        { id: 'notes', label: 'Notes', pinned: true, active: true },
        { id: 'tasks', label: 'Tasks', pinned: true, active: false },
      ],
    })
    expect(b.view.getAllByRole('menuitem').map(row => row.textContent))
      .toEqual(['Notes', 'Tasks', ...(browsable ? ['Browse other plugins'] : []), 'Create your plugin'])
    const currentRow = b.view.getByRole('menuitem', { name: 'Notes' })
    expect(currentRow.getAttribute('aria-current')).toBe('page')
    expect(currentRow.querySelector('svg')?.previousElementSibling?.textContent).toBe('Notes')
    expect(b.view.getByRole('menuitem', { name: 'Tasks' }).hasAttribute('aria-current')).toBe(false)
    expect(b.view.getAllByRole('separator')).toHaveLength(1)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Tasks' }))
    expect(b.onOpen).toHaveBeenCalledExactlyOnceWith('tasks')
    expect(b.onDismiss.mock.invocationCallOrder[0]).toBeLessThan(b.onOpen.mock.invocationCallOrder[0]!)
    expect(b.onPinnedChange).not.toHaveBeenCalled()
  })

  it.each([true, false])('keeps actions unseparated for an empty roster with plugin navigation present=%s', (browsable) => {
    const b = content({ region: 'conversation', entries: [], usePluginNavigation: select => select(browsable) })
    expect(b.view.getAllByRole('menuitem').map(row => row.textContent))
      .toEqual([...(browsable ? ['Browse other plugins'] : []), 'Create your plugin'])
    expect(b.view.queryByRole('separator')).toBeNull()
  })

  it.each(['sidebar', 'rightbar'] as const)('keeps only creation in %s without plugin navigation', (region) => {
    const b = content({ region, entries: [], usePluginNavigation: select => select(false) })
    expect(b.view.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['Create your plugin'])
    expect(b.view.queryByRole('separator')).toBeNull()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Create your plugin' }))
    expect(b.createPlugin).toHaveBeenCalledExactlyOnceWith()
    expect(b.onOpen).not.toHaveBeenCalled()
    expect(b.onPinnedChange).not.toHaveBeenCalled()
  })
})

type Seats = 'sidebar.panellist.actions'

function Frame({ renderSlot }: PropsRenderSlots<Seats>) {
  return <div role="menu" aria-label="sidebar.panellist.actions">
    {renderSlot('sidebar.panellist.actions', { entries: [], onOpen: () => {}, onPinnedChange: () => {}, onDismiss: () => {} })}
  </div>
}

async function bench(
  language: 'en' | 'zh' = 'en',
  { analytics = true, navigation = true }: { analytics?: boolean; navigation?: boolean } = {},
) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const openList = vi.fn(), startSession = vi.fn(), track = vi.fn<TrackProductEvent>()
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      const locale = new LocaleRuntime(ctx)
      locale.setLocale(language)
      ctx.provide('locale', locale)
      ctx.slots.installLocale(locale)
      if (navigation) ctx.provide('pluginNavigation', { openList } as never)
      ctx.provide('uiWorkspace', { startSession } as never)
      if (analytics) ctx.provide('productAnalytics', { track } as never)
    },
  })
  await runtime.root.declare({ 'sidebar.panellist.actions': { kind: 'list', scope: 'root' } }, Frame)
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, openList, startSession, track, plugin, view }
}

describe('left sidebar More menu rows', () => {
  it('shows plugin discovery only while the Plugins page navigation is present', async () => {
    const b = await bench('en', { navigation: false })
    const sidebar = (): ReturnType<typeof within> => within(b.view.getByRole('menu', { name: 'sidebar.panellist.actions' }))
    expect(sidebar().queryByRole('menuitem', { name: 'Browse other plugins' })).toBeNull()
    expect(sidebar().getByRole('menuitem', { name: 'Create your plugin' })).toBeTruthy()
    expect(sidebar().queryByRole('separator')).toBeNull()

    const navigation = await b.runtime.mount({
      inject: [],
      apply(ctx: Context) { ctx.provide('pluginNavigation', { openList: b.openList } as never) },
    })
    await act(async () => { await Promise.resolve() })
    fireEvent.click(sidebar().getByRole('menuitem', { name: 'Browse other plugins' }))
    expect(b.openList).toHaveBeenCalledExactlyOnceWith()

    await navigation.dispose()
    await act(async () => { await Promise.resolve() })
    expect(sidebar().queryByRole('menuitem', { name: 'Browse other plugins' })).toBeNull()
  })

  it('registers the sidebar rows once and removes them when the plugin unloads', async () => {
    const b = await bench()
    expect(b.runtime.slots.entries('sidebar.panellist.actions').map(entry => entry.options.id)).toEqual(['entry-customization'])
    const sidebar = within(b.view.getByRole('menu', { name: 'sidebar.panellist.actions' }))
    expect(sidebar.getAllByRole('menuitem').map(row => row.textContent))
      .toEqual(['Browse other plugins', 'Create your plugin'])
    fireEvent.click(sidebar.getByRole('menuitem', { name: 'Browse other plugins' }))
    expect(b.openList).toHaveBeenCalledExactlyOnceWith()
    await b.plugin.dispose()
    expect(b.runtime.slots.entries('sidebar.panellist.actions')).toEqual([])
    expect(sidebar.queryByRole('menuitem')).toBeNull()
  })

  it.each([
    ['en', 'Create a DSH plugin with a left sidebar entry.'],
    ['zh', '创建一个带左侧栏入口的 DSH 插件。'],
  ] as const)('starts an unsent %s Creator draft from the sidebar', async (language, prompt) => {
    const b = await bench(language)
    fireEvent.click(within(b.view.getByRole('menu', { name: 'sidebar.panellist.actions' }))
      .getByRole('menuitem', { name: language === 'zh' ? '创建你的插件' : 'Create your plugin' }))
    expect(b.startSession).toHaveBeenCalledExactlyOnceWith(undefined, {
      agentPreset: 'cordis', prompt, whenDraftExists: 'append',
    })
  })

  it('reports both sidebar actions as the sidebar region before acting', async () => {
    const b = await bench()
    const menu = within(b.view.getByRole('menu', { name: 'sidebar.panellist.actions' }))
    fireEvent.click(menu.getByRole('menuitem', { name: 'Browse other plugins' }))
    expect(b.track).toHaveBeenCalledExactlyOnceWith('more_menu_item_click', { region: 'sidebar', action: 'browse_plugins' })
    expect(b.track.mock.invocationCallOrder[0]).toBeLessThan(b.openList.mock.invocationCallOrder[0]!)
    fireEvent.click(menu.getByRole('menuitem', { name: 'Create your plugin' }))
    expect(b.track).toHaveBeenLastCalledWith('more_menu_item_click', { region: 'sidebar', action: 'create_plugin' })
    expect(b.track.mock.invocationCallOrder[1]).toBeLessThan(b.startSession.mock.invocationCallOrder[0]!)
    expect(b.track).toHaveBeenCalledTimes(2)
  })

  it('keeps both rows working without the analytics service', async () => {
    const b = await bench('en', { analytics: false })
    const menu = within(b.view.getByRole('menu', { name: 'sidebar.panellist.actions' }))
    fireEvent.click(menu.getByRole('menuitem', { name: 'Browse other plugins' }))
    fireEvent.click(menu.getByRole('menuitem', { name: 'Create your plugin' }))
    expect(b.openList).toHaveBeenCalledExactlyOnceWith()
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.track).not.toHaveBeenCalled()
  })
})

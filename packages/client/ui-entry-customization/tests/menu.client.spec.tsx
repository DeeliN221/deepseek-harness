// @vitest-environment jsdom
/** The plugin fills the left sidebar's More menu with discovery and Creator actions only. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { apply, inject } from '../src/client/index.ts'

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  try { for (const runtime of runtimes) await runtime.dispose() }
  finally { runtimes.clear(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() }
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

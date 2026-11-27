// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
/**
 * The sidebar's tool strip renders registered panel icons in the logo row plus
 * the settings seat. This suite covers dynamic membership, selection, locale
 * refresh, disposal, and analytics through the production slot renderer.
 */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { apply, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'sidebar-panel-test': 'alpha'
  }
}

/** Strip member the shell draws in its logo row. */
const TASK_CENTER = 'dsh-task-center' as MainPanelId
/** Second strip member, registered later by these specs. */
const TASK_BOARD = 'task-board' as MainPanelId
/** Additional registered panel, also available in the strip. */
const EXTRA = 'sidebar-test-extra' as MainPanelId
const PLUGINS = 'plugins' as MainPanelId
const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
    localStorage.clear()
  }
})

async function bench(collapsed = false, track?: TrackProductEvent) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const layout = {
    panelInfo: runtime.panelInfo,
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel: vi.fn((activePanelId: MainPanelId | null) => { runtime.panelInfo.set({ activePanelId }) }),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } satisfies ILayout
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
      ctx.provide('layout', layout)
      ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
      ctx.provide('locale', locale)
      if (track !== undefined) ctx.provide('productAnalytics', { track } as never)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'panel test: common locale')
      ctx.effect(() => locale.register('sidebar-panel-test', {
        zh: { alpha: '甲面板' }, en: { alpha: 'Alpha panel' },
      }), 'panel test: panel locale')
      ctx.slots.installLocale(locale)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'conversation' }, () => (
        <p>Conversation content</p>
      )))
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <aside>{renderSlot('sidebar', { collapsed, width: collapsed ? 56 : 360, drawer: false })}</aside>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })}</main>
      </>
    )
  }
  await runtime.root.declare({
    sidebar: { kind: 'single', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  const sidebar = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, locale, layout, sidebar, view }
}

interface TestPanel {
  id: MainPanelId
  heading: string
  order?: number
  label?: SlotLabel
}

async function mountPanel(runtime: SlotTestRuntime, { heading, ...metadata }: TestPanel) {
  function Icon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
    return (
      <span data-testid={`${metadata.id}-icon`} data-active={active}>
        <IconGlobeOutlineRegular size={size} />
      </span>
    )
  }
  function Body() {
    return (
      <section>
        <h1>{heading}</h1>
        <input aria-label={`${heading} input`} />
        <button type="button">{heading} action</button>
      </section>
    )
  }
  return runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: metadata.id }, Body))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', ...metadata }, Icon))
    },
  })
}

/** Both strip members: the tasks centre first, the board second. */
async function mountStrip(runtime: SlotTestRuntime, locale: LocaleRuntime) {
  const t = locale.bind('sidebar-panel-test')
  const centre = await mountPanel(runtime, { id: TASK_CENTER, heading: 'Tasks content', label: () => t('alpha'), order: 20 })
  const board = await mountPanel(runtime, { id: TASK_BOARD, heading: 'Board content', label: 'Task board', order: 10 })
  return { centre, board }
}

/** The logo-row tools nav, located by class so a locale switch cannot hide it. */
function strip(view: ReturnType<SlotTestRuntime['renderRoot']>) {
  const nav = view.container.querySelector<HTMLElement>('nav.dshsn-tools')
  if (nav === null) throw new Error('tools nav not rendered')
  return nav
}

describe('sidebar fixed tool strip', () => {
  it('renders no panel rows and no More menu, and keeps a panel body reachable by selection', async () => {
    const { runtime, view } = await bench()
    // The tools nav carries the settings seat even before any panel registers.
    expect(within(strip(view)).queryAllByRole('button')).toHaveLength(0)
    expect(strip(view).parentElement?.querySelector('.dshsn-settings')).toBeTruthy()
    expect(view.queryByRole('menu')).toBeNull()
    expect(view.queryByRole('button', { name: 'More' })).toBeNull()
    expect(view.getByText('Conversation content')).toBeTruthy()

    const extra = await mountPanel(runtime, { id: EXTRA, heading: 'Extra content', label: 'Extra panel' })
    const button = await within(strip(view)).findByRole('button', { name: 'Extra panel' })
    fireEvent.click(button)
    expect(view.getByRole('heading', { name: 'Extra content' })).toBeTruthy()
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['conversation', EXTRA])
    await extra.dispose()
    await waitFor(() => { expect(within(strip(view)).queryByRole('button', { name: 'Extra panel' })).toBeNull() })
  })

  it.each([false, true])('renders the strip members as icons with collapsed=%s', async (collapsed) => {
    const { runtime, locale, view } = await bench(collapsed)
    await mountStrip(runtime, locale)
    const nav = strip(view)
    const icons = within(nav).getAllByRole('button')
    // Registration order wins over the strip's declaration order.
    expect(icons.map(icon => icon.getAttribute('aria-label'))).toEqual(['Task board', 'Alpha panel'])
    expect(icons.map(icon => icon.getAttribute('data-dshsn-panel'))).toEqual([TASK_BOARD, TASK_CENTER])
    for (const [id, label] of [[TASK_BOARD, 'Task board'], [TASK_CENTER, 'Alpha panel']] as const) {
      const icon = within(nav).getByRole('button', { name: label })
      expect(icon.getAttribute('aria-current')).toBeNull()
      // The label lives in the accessible name only: the row is icon-only.
      expect(icon.textContent).toBe('')
      expect(within(icon).getByTestId(`${id}-icon`).getAttribute('data-active')).toBe('false')
    }
  })

  it('selects the panel behind an icon and keeps a repeated selection active', async () => {
    const { runtime, locale, layout, view } = await bench()
    await mountStrip(runtime, locale)
    const nav = strip(view)
    const centre = within(nav).getByRole('button', { name: 'Alpha panel' })
    const board = within(nav).getByRole('button', { name: 'Task board' })
    fireEvent.click(centre)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(TASK_CENTER)
    expect(runtime.panelInfo.getSnapshot()).toEqual({ activePanelId: TASK_CENTER })
    expect(centre.getAttribute('aria-current')).toBe('page')
    expect(board.getAttribute('aria-current')).toBeNull()
    expect(within(centre).getByTestId(`${TASK_CENTER}-icon`).getAttribute('data-active')).toBe('true')
    expect(view.getByRole('heading', { name: 'Tasks content' })).toBeTruthy()

    fireEvent.click(centre)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(TASK_CENTER)
    expect(centre.getAttribute('aria-current')).toBe('page')

    fireEvent.click(board)
    expect(layout.selectPanel).toHaveBeenLastCalledWith(TASK_BOARD)
    expect(centre.getAttribute('aria-current')).toBeNull()
    expect(board.getAttribute('aria-current')).toBe('page')
    expect(within(centre).getByTestId(`${TASK_CENTER}-icon`).getAttribute('data-active')).toBe('false')
    expect(view.queryByRole('heading', { name: 'Tasks content' })).toBeNull()
    expect(view.getByRole('heading', { name: 'Board content' })).toBeTruthy()
  })

  it('refreshes a locale label without re-registering the icon', async () => {
    const { runtime, locale, view } = await bench()
    await mountStrip(runtime, locale)
    const entries = runtime.slots.entries('sidebar.panellist')
    act(() => { locale.setLocale('zh') })
    await waitFor(() => {
      expect(within(strip(view)).getByRole('button', { name: '甲面板' }).getAttribute('data-dshsn-panel')).toBe(TASK_CENTER)
    })
    // A plain label stays as registered.
    expect(within(strip(view)).getByRole('button', { name: 'Task board' })).toBeTruthy()
    expect(runtime.slots.entries('sidebar.panellist')).toBe(entries)
  })

  it('removes only the disposed panel icon', async () => {
    const { runtime, locale, view } = await bench()
    const { centre } = await mountStrip(runtime, locale)
    expect(within(strip(view)).getAllByRole('button')).toHaveLength(2)
    await centre.dispose()
    await waitFor(() => {
      expect(within(strip(view)).queryByRole('button', { name: 'Alpha panel' })).toBeNull()
    })
    expect(within(strip(view)).getAllByRole('button').map(icon => icon.getAttribute('data-dshsn-panel')))
      .toEqual([TASK_BOARD])
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['conversation', TASK_BOARD])
  })

  it('disposes the sidebar while retaining independently owned main panel bodies', async () => {
    const { runtime, locale, sidebar, view } = await bench()
    await mountStrip(runtime, locale)
    fireEvent.click(within(strip(view)).getByRole('button', { name: 'Alpha panel' }))
    await sidebar.dispose()
    expect(view.queryByRole('navigation', { name: 'Global panels' })).toBeNull()
    expect(runtime.slots.spec('sidebar.panellist')).toBeUndefined()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    // The panel body is owned by its own registration, not by the sidebar.
    expect(view.getByRole('heading', { name: 'Tasks content' })).toBeTruthy()
    await runtime.mount({ inject: [...inject], apply })
    const restored = await within(strip(view)).findByRole('button', { name: 'Alpha panel' })
    expect(restored.getAttribute('aria-current')).toBe('page')
    // Remounting restores both strip members in the shell's order ranking.
    expect(runtime.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual([TASK_BOARD, TASK_CENTER])
  })

  it('shows the Plugins launcher in the logo row without joining the strip', async () => {
    const { runtime, view } = await bench()
    await mountPanel(runtime, { id: PLUGINS, heading: 'Plugins content', label: 'Plugins' })
    const plugins = await view.findByRole('button', { name: 'Plugins' })
    expect(plugins.getAttribute('data-dshsn-panel')).toBeNull()
    expect(within(strip(view)).queryByRole('button', { name: 'Plugins' })).toBeNull()
  })
})

describe('sidebar view tabs', () => {
  const CONTEXT = 'dsh-context' as MainPanelId
  const BOT_TEAM = 'bot-team' as MainPanelId

  it('keeps the second row to two view tabs and returns to the conversation from a tool', async () => {
    const { runtime, locale, layout, view } = await bench()
    expect(view.queryByRole('button', { name: 'Bot Team' })).toBeNull()
    await mountStrip(runtime, locale)
    await mountPanel(runtime, { id: CONTEXT, heading: 'Context content', label: 'Context', order: 30 })
    await mountPanel(runtime, { id: BOT_TEAM, heading: 'Bot Team content', label: 'Bot Team', order: 40 })

    // Three fixed tools in the logo row; the Bot Team panel is a tab, never a tool.
    expect([...strip(view).querySelectorAll('[data-dshsn-panel]')].map(node => node.getAttribute('data-dshsn-panel')))
      .toEqual([TASK_BOARD, TASK_CENTER, CONTEXT])

    const tabs = within(view.container.querySelector('nav.dshsn-tabs')!).getAllByRole('button')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Workspace', 'Bot Team'])
    expect(tabs.map(tab => tab.getAttribute('aria-current'))).toEqual(['page', null])

    // Selecting a tool clears the workspace tab's selection.
    fireEvent.click(within(strip(view)).getByRole('button', { name: 'Alpha panel' }))
    expect(layout.selectPanel).toHaveBeenLastCalledWith(TASK_CENTER)
    expect(within(view.container.querySelector('nav.dshsn-tabs')!).getAllByRole('button').map(tab => tab.getAttribute('aria-current'))).toEqual([null, null])
    expect(view.getByRole('button', { name: 'Workspace' }).tabIndex).toBe(0)

    // The Workspace tab clears the panel and returns to the Conversation.
    fireEvent.click(view.getByRole('button', { name: 'Workspace' }))
    expect(layout.selectPanel).toHaveBeenLastCalledWith(null)
    expect(within(view.container.querySelector('nav.dshsn-tabs')!).getAllByRole('button').map(tab => tab.getAttribute('aria-current'))).toEqual(['page', null])
    expect(view.getByText('Conversation content')).toBeTruthy()
  })

  it('selects the Bot Team panel from its tab and marks it active', async () => {
    const { runtime, locale, layout, view } = await bench()
    await mountStrip(runtime, locale)
    await mountPanel(runtime, { id: BOT_TEAM, heading: 'Bot Team content', label: 'Bot Team', order: 40 })
    fireEvent.click(view.getByRole('button', { name: 'Bot Team' }))
    expect(layout.selectPanel).toHaveBeenLastCalledWith(BOT_TEAM)
    expect(within(view.container.querySelector('nav.dshsn-tabs')!).getAllByRole('button').map(tab => tab.getAttribute('aria-current'))).toEqual([null, 'page'])
    expect(view.getByRole('heading', { name: 'Bot Team content' })).toBeTruthy()
    // A repeated activation does not re-select.
    const calls = layout.selectPanel.mock.calls.length
    fireEvent.click(view.getByRole('button', { name: 'Bot Team' }))
    expect(layout.selectPanel.mock.calls).toHaveLength(calls)
  })

  it('renders the collapsed rail vertically below the logo row with no tabs', async () => {
    const { runtime, locale, view } = await bench(true)
    await mountStrip(runtime, locale)
    const nav = strip(view)
    // The stable wrapper stays in the logo row so the settings seat remains mounted.
    expect(view.queryAllByRole('tab')).toHaveLength(0)
    expect(nav.closest('[data-window-drag]')).not.toBeNull()
    expect(nav.querySelector('[data-dshsn-panel]')).not.toBeNull()
    expect(nav.parentElement?.querySelector('.dshsn-settings')).not.toBeNull()
  })
})

describe('sidebar entry click analytics', () => {
  it('reports the Plugins launcher and leaves strip icons unreported', async () => {
    const track = vi.fn<TrackProductEvent>()
    const { runtime, locale, layout, view } = await bench(false, track)
    await mountStrip(runtime, locale)
    await mountPanel(runtime, { id: PLUGINS, heading: 'Plugins content', label: 'Plugins' })
    fireEvent.click(await view.findByRole('button', { name: 'Plugins' }))
    for (const name of ['Alpha panel', 'Task board']) {
      fireEvent.click(within(strip(view)).getByRole('button', { name }))
    }
    expect(track.mock.calls).toEqual([['sidebar_menu_click', { menu_name: 'plugin', position: 'sidebar' }]])
    expect(layout.selectPanel.mock.calls).toEqual([[PLUGINS], [TASK_CENTER], [TASK_BOARD]])
    expect(track.mock.invocationCallOrder[0]).toBeLessThan(layout.selectPanel.mock.invocationCallOrder[0]!)
  })
})

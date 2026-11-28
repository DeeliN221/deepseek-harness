/**
 * Sidebar shell: column geometry and global panel navigation.
 * Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * global panel rows and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 * Through the browser's hookContext, the shell also hands it the scroller hook
 * that continues wheel scrolling over the sidebar viewport into its list.
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import clsx from 'clsx'
import {
  focusWithoutRing, IconPanelLeftOutlineRegular, Menu,
  isBehindModal, isDarwinDesktop, Tooltip, useModalLayer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SidebarRootComponentProps, SidebarSectionHookContext,
} from './contract/slots.ts'
import { FIXED_PANEL_ID } from './panel-pins.ts'
import { NavGlyph } from './nav-icons.tsx'
import { createScrollHandoff } from './scroll-handoff.ts'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/** Panel id of the Bot Team view selected by the second-row tab. */
const BOT_TEAM_PANEL_ID = 'bot-team'

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  drawer,
  startSession,
  toggleSidebar,
  selectPanel,
  trackEntryClick,
  useRemoteAccess,
  usePanels,
  useShortcuts,
  usePanelInfo,
  t,
  renderSlot,
  renderFactorySlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const pluginsPanel = panels.find(({ id }) => id === FIXED_PANEL_ID)
  const botTeamId = panels.find(({ id }) => id === BOT_TEAM_PANEL_ID)?.id
  // 工具组渲染**全部已注册面板**（注册/注销即时生效），只排除两处既有入口的
  // 重复：logo 行固定的插件入口，以及第二行的 Bot Team 专属页签。
  // The strip carries only these two panels; context insight and the team view
  // moved out (menu item / segmented switch), so the row stays one short line.
  const TOOL_PANEL_IDS = new Set(['dsh-task-center', 'task-board'])
  const toolPanels = panels.filter(({ id }) => TOOL_PANEL_IDS.has(id))
  const toolsRef = useRef<HTMLElement | null>(null)
  const [toolsOverflow, setToolsOverflow] = useState<'none' | 'start' | 'end' | 'both'>('none')
  useEffect(() => {
    const node = toolsRef.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      const vertical = node.getAttribute('data-wide') === 'false'
      const start = vertical ? node.scrollTop : node.scrollLeft
      const size = vertical ? node.clientHeight : node.clientWidth
      const total = vertical ? node.scrollHeight : node.scrollWidth
      const before = start > 1
      const after = start + size < total - 1
      setToolsOverflow(before && after ? 'both' : before ? 'start' : after ? 'end' : 'none')
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    node.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', update)
    }
  }, [panels, width])
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'))
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  // A page whose access snapshot excludes starting a Session offers no New Session affordance.
  const canStartSession = useRemoteAccess('session/create')
  const toggleLabel = collapsed ? t('toggle.open') : t('toggle.collapse')
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  // A closed drawer retains its content with the rail phase already settled.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (drawer || !collapsed) { setSettled(collapsed); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed, drawer])
  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const wide = drawer || (windowsTitlebar ? !collapsed : !collapsed || !settled)
  const [scrollHandoff] = useState(createScrollHandoff)
  const sectionHookContext = useMemo<SidebarSectionHookContext>(
    () => ({ useSectionScroller: scrollHandoff.useSectionScroller }), [scrollHandoff],
  )
  // The Windows titlebar hosts the New Session controls while the sidebar is collapsed.
  const openNewSession = (): void => {
    trackEntryClick({ menu_name: 'new_session', position: windowsTitlebar && collapsed ? 'titlebar' : 'sidebar' })
    startSession()
  }
  // The Windows caption menus occupy the strip to the right of these controls
  // (that is what --dsh-windows-menu-start reserves), so a right-side bubble
  // lands under their text. Below the caption is the only clear side.
  const captionTooltipSide = windowsTitlebar ? 'bottom' : 'right'
  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (drawer || !collapsed) lastWideWidth.current = width

  // A closed drawer returns to the static rail; only a live collapse fades it in.
  const animateRail = useRef(!collapsed)
  if (drawer || !collapsed) animateRail.current = !collapsed

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const sidebarFocus = useRef<Element | null>(null)
  const [coveredBySettings, setCoveredBySettings] = useState(false)
  useLayoutEffect(() => {
    const document = column.current?.ownerDocument
    if (document === undefined) return
    const update = (): void => { setCoveredBySettings(document.querySelector('[data-shortcut-modal="settings"][role="dialog"][aria-modal="true"]') !== null) }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'data-shortcut-modal'] })
    return () => { observer.disconnect() }
  }, [])
  useModalLayer(column, drawer && !collapsed && !coveredBySettings, toggleSidebar)
  useLayoutEffect(() => {
    if (!collapsed) return
    const controlled = sidebarFocus.current?.getAttribute('aria-controls')?.split(/\s+/) ?? []
    const ownsMenuFocus = controlled.some(id => document.getElementById(id)?.contains(document.activeElement))
    if (sidebarFocus.current !== document.activeElement && !ownsMenuFocus) return
    const opener = drawer
      ? column.current?.ownerDocument.querySelector<HTMLElement>('[data-sidebar-opener]')
      : column.current?.querySelector<HTMLElement>('[data-sidebar-toggle]')
    if (opener != null && !isBehindModal(opener)) focusWithoutRing(opener, { preventScroll: true })
  }, [drawer, collapsed])
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const darwinDesktop = isDarwinDesktop()
  // Rail resting state is the whale mark; hovering swaps in the panel icon
  // (the expand affordance, figma sidebar-hover flow). Expanded it is a plain
  // panel icon.
  const toggle = (
    <Tooltip label={toggleLabel} shortcutKeys={shortcut?.keys} delayMs={500} side={captionTooltipSide} portal={drawer}>
      <button
        data-sidebar-toggle
        data-modal-autofocus={drawer || undefined}
        type="button"
        className={clsx(css.iconButton, css.toggle)}
        aria-label={toggleLabel}
        aria-keyshortcuts={shortcut?.aria}
        onClick={() => { toggleSidebar() }}
      >
        {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
        <IconPanelLeftOutlineRegular className={css.panelIcon} size={wide || windowsTitlebar ? 16 : 18} />
        {!wide && renderSlot('sidebar.toggle.badge', {})}
      </button>
    </Tooltip>
  )

  // Ambient glyph motion pauses while the page is hidden, and a pointerdown
  // (mouse, pen or touch) tags the pressed button for one full feedback run —
  // touch has no hover, so `:active` alone would cut the gesture short.
  useEffect(() => {
    const onVisibility = (): void => {
      column.current?.classList.toggle('nav-idle-paused', document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  useEffect(() => {
    const timers = new Set<number>()
    const onPointerDown = (event: PointerEvent): void => {
      const button = (event.target as Element | null)?.closest('button[aria-label]')
      if (button === null || button === undefined) return
      button.setAttribute('data-nav-tap', '')
      const timer = window.setTimeout(() => {
        button.removeAttribute('data-nav-tap')
        timers.delete(timer)
      }, 700)
      timers.add(timer)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  // Settings, achievements and the workbench used to sit in the footer; they
  // now ride in the More menu so the column keeps a single top strip.
  const parked = useRef<HTMLDivElement>(null)
  const clickParked = (label: string): void => {
    setMoreOpen(false)
    const button = [...(parked.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(candidate => ((candidate.getAttribute('aria-label') ?? candidate.textContent) || '').includes(label))
    button?.click()
  }
  const [moreOpen, setMoreOpen] = useState(false)
  const moreMenu = (
    <Menu
      open={moreOpen}
      onClose={() => { setMoreOpen(false) }}
      portal
      autoFocus
      listClassName="dshsn-moreList"
      anchor={(
        <Tooltip label={t('panels.more')} delayMs={400} side="bottom">
          <button
            type="button"
            className="dshsn-icon"
            aria-label={t('panels.more')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            data-dshsn-more="true"
            onClick={() => { setMoreOpen(value => !value) }}
          >
            <span className="dshsn-glyph" aria-hidden="true">
              <NavGlyph name="more" size={16} />
            </span>
          </button>
        </Tooltip>
      )}
    >
      <button type="button" className="dshsn-moreItem" onClick={() => { clickParked('设置') }}>设置</button>
      <button type="button" className="dshsn-moreItem" onClick={() => { clickParked('成就') }}>成就</button>
      <button
        type="button"
        className="dshsn-moreItem"
        onClick={() => { setMoreOpen(false); selectPanel('dsh-context' as MainPanelId) }}
      >
        {panels.find(({ id }) => id === 'dsh-context')?.label ?? '上下文洞察'}
      </button>
    </Menu>
  )

  // Top tools and the second-row tabs are built once and placed per width.
  const toolsNav = (
    <div
      className="dshsn-toolsWrap"
      data-overflow={toolsOverflow}
      data-wide={wide ? 'true' : 'false'}
    >
      <nav
        ref={toolsRef}
        className="dshsn-tools"
        aria-label={t('panels.label')}
        data-wide={wide ? 'true' : 'false'}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const node = toolsRef.current
          if (node === null) return
          const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button[data-dshsn-panel]'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if (index < 0) return
          const next = event.key === 'ArrowRight' ? index + 1 : index - 1
          if (next < 0 || next >= buttons.length) return
          event.preventDefault()
          buttons[next]?.focus()
        }}
      >
        {toolPanels.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={clsx('dshsn-icon', activePanelId === id && 'dshsn-iconOn')}
            aria-label={label}
            aria-current={activePanelId === id ? 'page' : undefined}
            data-dshsn-panel={id}
            onFocus={(event) => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
            onClick={() => { selectPanel(id) }}
          >
            <span className="dshsn-glyph" aria-hidden="true">
              {renderFactorySlot('sidebar.panel.icon', { id, size: 16, active: activePanelId === id })}
            </span>
          </button>
        ))}
        {moreMenu}
        {canStartSession && renderSlot('sidebar.session.action', { wide }, {
          children: (
            <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={400} side="bottom">
              <button
                type="button"
                className="dshsn-icon"
                aria-label={t('session.new.label')}
                aria-keyshortcuts={newShortcut?.aria}
                data-dshsn-new-session="true"
                onClick={openNewSession}
              >
                <span className="dshsn-glyph" aria-hidden="true">
                  <NavGlyph name="new-session" size={16} />
                </span>
              </button>
            </Tooltip>
          ),
        })}
      </nav>
    </div>
  )

  // 工作区 / 智能体团队: one segmented control where the section header used to
  // be. The choice drives both the main view and the region below, and it
  // survives a reload through localStorage.
  const VIEW_KEY = 'dsh-sidebar-view'
  const [sidebarView, setSidebarView] = useState<'workspace' | 'team'>(() => {
    try { return window.localStorage.getItem(VIEW_KEY) === 'team' ? 'team' : 'workspace' } catch { return 'workspace' }
  })
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_KEY, sidebarView) } catch { /* private mode: keep the session state */ }
  }, [sidebarView])
  useEffect(() => {
    if (sidebarView === 'team' && botTeamId !== undefined && activePanelId !== botTeamId) selectPanel(botTeamId)
    // Restore only once, on mount: later visits go through the control.
  }, [])
  const chooseView = (next: 'workspace' | 'team'): void => {
    setSidebarView(next)
    if (next === 'team') { if (botTeamId !== undefined) selectPanel(botTeamId) }
    else if (activePanelId != null) selectPanel(null)
  }
  const viewSwitch = (
    <div className="dshsn-switch" role="tablist" aria-label={t('tabs.label')}>
      <button
        type="button"
        role="tab"
        aria-selected={sidebarView === 'workspace'}
        className={clsx('dshsn-switchOption', sidebarView === 'workspace' && 'dshsn-switchOn')}
        data-dshsn-view="workspace"
        onClick={() => { chooseView('workspace') }}
      >
        {t('tabs.workspace')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={sidebarView === 'team'}
        className={clsx('dshsn-switchOption', sidebarView === 'team' && 'dshsn-switchOn')}
        data-dshsn-view="team"
        onClick={() => { chooseView('team') }}
      >
        {t('tabs.team')}
      </button>
    </div>
  )

  return (
    <div
      ref={column}
      onFocusCapture={(event) => { sidebarFocus.current = event.target }}
      role={drawer ? 'dialog' : undefined}
      data-shortcut-modal={drawer ? 'sidebar' : undefined}
      aria-modal={drawer && !collapsed ? true : undefined}
      aria-label={drawer ? t('navigation.label') : undefined}
      tabIndex={drawer ? -1 : undefined}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && animateRail.current && css.railIn,
        !drawer && collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: !drawer && collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      {/* macOS hiddenInset titlebar: retain traffic-light clearance and the collapsed toggle. */}
      {darwinDesktop && <div className={css.topStrip} data-window-drag>{!wide && toggle}</div>}
      <div className={css.logoRow} data-window-drag>
        {pluginsPanel !== undefined && (
          <Tooltip label={pluginsPanel.label} delayMs={500} side="bottom" portal>
            <button
              type="button"
              className={clsx(css.iconButton, css.pluginsButton)}
              data-dshsn-plugins="true"
              aria-label={pluginsPanel.label}
              aria-current={activePanelId === pluginsPanel.id ? 'page' : undefined}
              onClick={() => {
                trackEntryClick({ menu_name: 'plugin', position: 'sidebar' })
                selectPanel(pluginsPanel.id)
              }}
            >
              <span className={css.panelGlyph} aria-hidden="true">
                {renderFactorySlot('sidebar.panel.icon', { id: pluginsPanel.id, size: 16, active: activePanelId === pluginsPanel.id })}
              </span>
            </button>
          </Tooltip>
        )}
        {toolsNav}
        {(!darwinDesktop || wide) && toggle}
      </div>

      {/* Second row: 工作区 / Bot Team only. */}
      {viewSwitch}

      {/* The label fades before the hover/focus shortcut, including on translucent backgrounds. */}

      {/* Settings, achievements and the workbench stay mounted in their own
          column context; the More menu opens them through their triggers. */}
      <div ref={parked} className={css.parkedSeats} aria-hidden="true">
        {renderSlot('sidebar.settings', { wide })}
        {renderSlot('sidebar.footer.action', { wide })}
      </div>

      <div className={css.scrollRegion}>
        <div
          ref={scrollHandoff.bindViewportRef}
          className={css.scrollArea}
          data-sidebar-scrollport={wide ? '' : undefined}
        >
          <div
            className={clsx(css.regionArea, sidebarView === 'team' && css.regionAreaTeam)}
            data-sidebar-view={sidebarView}
          >
            {sidebarView === 'workspace'
              ? renderSlot('sidebar.workspaces', {
                wide,
                expandSidebar: () => { if (collapsed) toggleSidebar() },
              }, { hookContext: sectionHookContext })
              : null}
          </div>
        </div>
        <span className={css.scrollFade} aria-hidden="true" />
      </div>

    </div>
  )
}

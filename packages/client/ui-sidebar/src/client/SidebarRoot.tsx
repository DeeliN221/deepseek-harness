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
import clsx from 'clsx'
import {
  FishLogo, focusWithoutRing, IconNewChatOutlineRegular, IconPanelLeftOutlineRegular,
  isBehindModal, isDarwinDesktop, Toast, Tooltip, useModalLayer, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SidebarRootComponentProps, SidebarSectionHookContext,
} from './contract/slots.ts'
import { FIXED_PANEL_ID } from './panel-pins.ts'
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

/** Panels rendered as icon buttons in the logo row (top tools). */
const STRIP_PANEL_IDS: readonly string[] = ['dsh-task-center', 'task-board', 'dsh-context']

/** Panel id of the Bot Team view selected by the second-row tab. */
const BOT_TEAM_PANEL_ID = 'bot-team'

/** Expanded columns narrower than this keep only the brand mark in the logo row. */
const TOOLBAR_WORDMARK_MIN_WIDTH = 320

/** Format complete-build metadata for the local brand badge. */
function localBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}

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
  // The Bot Team tab addresses a panel the running profile registers; without
  // one the second row keeps the Workspace tab alone.
  const botTeamId = panels.find(({ id }) => id === BOT_TEAM_PANEL_ID)?.id
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
  useModalLayer(column, drawer && !collapsed, toggleSidebar)
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

  const buildVersion = localBuildVersion()
  // The local-build fallbacks copy the badge text; the brand button below
  // skips New Session for clicks inside them. The click still bubbles, so
  // document-level outside-click listeners see it.
  // Each successful copy bumps the key so a repeated copy replays the toast.
  const [copiedToast, setCopiedToast] = useState<number | null>(null)
  const copyVersion = (version: string) => (): void => {
    void writeClipboard(version).then((ok) => {
      if (ok) setCopiedToast(seq => (seq ?? 0) + 1)
    })
  }

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
        {!wide && !windowsTitlebar && (
          <span className={css.railMark} aria-hidden="true">
            {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
          </span>
        )}
        {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
        <IconPanelLeftOutlineRegular className={css.panelIcon} size={wide || windowsTitlebar ? 16 : 18} />
        {!wide && renderSlot('sidebar.toggle.badge', {})}
      </button>
    </Tooltip>
  )

  // Top tools and the second-row tabs are built once and placed per width.
  const toolsNav = (
    <nav className="dshsn-tools" aria-label={t('panels.label')} data-wide={wide ? 'true' : 'false'}>
      {panels.filter(({ id }) => STRIP_PANEL_IDS.includes(id)).map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={clsx('dshsn-icon', activePanelId === id && 'dshsn-iconOn')}
          aria-label={label}
          aria-current={activePanelId === id ? 'page' : undefined}
          data-dshsn-panel={id}
          onClick={() => { selectPanel(id) }}
        >
          <span className="dshsn-glyph" aria-hidden="true">
            {renderFactorySlot('sidebar.panel.icon', { id, size: 16, active: activePanelId === id })}
          </span>
        </button>
      ))}
      <div className="dshsn-settings">
        {renderSlot('sidebar.settings', { wide: false })}
      </div>
    </nav>
  )

  const tabs = (
    <div className="dshsn-tabs" role="tablist" aria-label={t('tabs.label')}>
      <button
        type="button"
        role="tab"
        aria-selected={activePanelId == null}
        className={clsx('dshsn-tab', activePanelId == null && 'dshsn-tabOn')}
        onClick={() => { if (activePanelId != null) selectPanel(null) }}
      >
        {t('tabs.workspace')}
      </button>
      {botTeamId !== undefined && (
        <button
          type="button"
          role="tab"
          aria-selected={activePanelId === botTeamId}
          className={clsx('dshsn-tab', activePanelId === botTeamId && 'dshsn-tabOn')}
          data-dshsn-active={activePanelId === botTeamId ? 'true' : 'false'}
          onClick={() => { if (activePanelId !== botTeamId) selectPanel(botTeamId) }}
        >
          {t('tabs.botTeam')}
        </button>
      )}
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
        {/* Expanded, the brand doubles as a New Session shortcut while the
            access snapshot allows `session/create` — except on
            macOS, where it stays part of the logo row's window-drag surface
            (the drag-row controls rule would subtract a button);
            the collapsed rail's logo is the expand toggle below instead.
            Mouse clicks on the local-build fallbacks copy the version instead. */}
        {wide && (() => {
          const identity = (
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandMark}>
                {renderSlot('sidebar.brand.mark', { size: 24 }, {
                  fallback: buildVersion === undefined
                    ? <FishLogo size={24} />
                    : <span className={css.copyVersion} data-copy-version onClick={copyVersion(buildVersion)}><FishLogo size={24} /></span>,
                })}
              </span>
              {width >= TOOLBAR_WORDMARK_MIN_WIDTH && (
                <span className={css.brandName}>
                  {renderSlot('sidebar.brand.name', {}, {
                    fallback: buildVersion === undefined
                      ? <span className={css.fallbackBrandName}>{t('brand.localBuild')}</span>
                      : (
                        <span className={clsx(css.localBuildBrand, css.copyVersion)} data-copy-version onClick={copyVersion(buildVersion)}>
                          <span className={css.localBuildTitle}>{t('brand.localBuild')}</span>
                          <span className={css.buildVersion}>{buildVersion}</span>
                        </span>
                      ),
                  })}
                </span>
              )}
            </span>
          )
          return darwinDesktop || !canStartSession
            ? <span className={clsx(css.brand, css.wide)}>{identity}</span>
            : (
              <button
                type="button"
                className={clsx(css.brand, css.wide)}
                aria-label={t('session.new.label')}
                aria-keyshortcuts={newShortcut?.aria}
                onClick={(event) => {
                  if ((event.target as Element).closest('[data-copy-version]') !== null) return
                  openNewSession()
                }}
              >
                {identity}
              </button>
            )
        })()}
        {wide && pluginsPanel !== undefined && (
          <Tooltip label={pluginsPanel.label} delayMs={500} side="bottom" portal>
            <button
              type="button"
              className={clsx(css.iconButton, css.pluginsButton)}
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
        {wide && toolsNav}
        {(!darwinDesktop || wide) && toggle}
      </div>

      {/* The collapsed rail reuses the same tools column below the logo row. */}
      {!wide && toolsNav}

      {/* Second row: 工作区 / Bot Team only. */}
      {wide && tabs}

      {/* The label fades before the hover/focus shortcut, including on translucent backgrounds. */}
      {canStartSession && (
        <div className={css.newSessionRow}>
          {renderSlot('sidebar.session.action', { wide }, {
            children: (
              <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500} side={captionTooltipSide} disabled={wide}>
                <button
                  type="button"
                  className={css.newSession}
                  aria-label={t('session.new.label')}
                  aria-keyshortcuts={newShortcut?.aria}
                  onClick={openNewSession}
                >
                  <span className={css.newSessionLabelMask}><span className={css.newSessionContent}>
                    <IconNewChatOutlineRegular size={windowsTitlebar ? 16 : 18} />
                  </span></span>
                </button>
              </Tooltip>
            ),
          })}
        </div>
      )}

      <div className={css.scrollRegion}>
        <div
          ref={scrollHandoff.bindViewportRef}
          className={css.scrollArea}
          data-sidebar-scrollport={wide ? '' : undefined}
        >
          <div className={css.regionArea}>
            {renderSlot('sidebar.workspaces', {
              wide,
              expandSidebar: () => { if (collapsed) toggleSidebar() },
            }, { hookContext: sectionHookContext })}
          </div>
        </div>
        <span className={css.scrollFade} aria-hidden="true" />
      </div>

      {copiedToast !== null && (
        <Toast key={copiedToast} tone="success" text={t('version.copied')} onDone={() => { setCopiedToast(null) }} />
      )}

      {/* Footer actions only: Settings moved into the logo-row tools. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
      </div>
    </div>
  )
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { FishLogo, IconNewChatOutlineRegular, IconPanelLeftOutlineRegular, IconPinFillRegular, focusWithoutRing, isBehindModal, isDarwinDesktop, Toast, Tooltip, useModalLayer, writeClipboard, } from '@deepseek-ai/dsh-client-ui-primitives';
import { FIXED_PANEL_ID } from "./panel-pins.js";
import { createScrollHandoff } from "./scroll-handoff.js";
import css from './SidebarRoot.module.css';
/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150;
/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000;
/**
 * Panels the column lists as navigation rows, matched by registration id so
 * a deployment's panel labels do not decide the layout.
 */
const NAV_PANEL_IDS = ['dsh-task-center', 'task-board', 'bot-team'];
/**
 * Panels launched from the header row beside the Plugins control instead of
 * the navigation list; the rail falls back to rows so they stay reachable.
 */
const HEADER_PANEL_IDS = ['dsh-context'];
/** Format complete-build metadata for the local brand badge. */
function localBuildVersion() {
    const version = process.env.DSH_CLIENT_VERSION;
    if (version === undefined)
        return undefined;
    const commit = process.env.DSH_CLIENT_COMMIT_HASH;
    return version
        + (commit === undefined ? '' : `-${commit}`)
        + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '');
}
/** Analytics category of an official panel; other panels are never reported. */
function officialEntry(id) {
    if (id === 'plugins')
        return 'plugin';
    return id === 'schedules' ? 'cron' : undefined;
}
/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, wide, unpinLabel, unpinTooltip, canUnpin, usePanelInfo, selectPanel, setPinned, trackEntryClick, renderFactorySlot, }) {
    const active = usePanelInfo(info => info.activePanelId === id);
    return (_jsxs("div", { className: clsx(css.panelEntry, wide && css.panelEntryWide, active && css.panelEntryActive), children: [_jsx(Tooltip, { label: label, delayMs: 500, disabled: wide, children: _jsxs("button", { type: "button", className: css.panelRow, "aria-label": label, "aria-current": active ? 'page' : undefined, onClick: () => {
                        const entry = officialEntry(id);
                        if (entry !== undefined)
                            trackEntryClick({ menu_name: entry, position: 'sidebar' });
                        selectPanel(id);
                    }, children: [_jsx("span", { className: css.panelGlyph, "aria-hidden": "true", children: renderFactorySlot('sidebar.panel.icon', { id, size: wide ? 16 : 18, active }) }), wide && (_jsx("span", { className: clsx(css.panelTitle, css.wide), children: label }))] }) }), wide && canUnpin && _jsx(Tooltip, { label: unpinTooltip, side: "bottom", align: "end", delayMs: 500, portal: true, children: _jsx("button", { type: "button", className: css.panelUnpin, "aria-label": unpinLabel, onClick: (event) => {
                        // Unpin is rendered only while this navigation also renders More.
                        const navigation = event.currentTarget.closest('nav');
                        const more = navigation.querySelector('button[aria-haspopup="menu"]');
                        focusWithoutRing(more);
                        setPinned(id, false);
                    }, children: _jsx(IconPinFillRegular, { size: 14 }) }) })] }));
}
/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({ collapsed, width, drawer, startSession, toggleSidebar, selectPanel, setPinned, trackEntryClick, useRemoteAccess, usePanels, useShortcuts, usePanelInfo, t, renderSlot, renderFactorySlot, }) {
    const panels = usePanels(snapshot => snapshot);
    const activePanelId = usePanelInfo(info => info.activePanelId);
    const pluginsPanel = panels.find(({ id }) => id === FIXED_PANEL_ID);
    const headerPanels = useMemo(() => panels.filter(({ id }) => HEADER_PANEL_IDS.includes(id)), [panels]);
    const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'));
    const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'));
    // A page whose access snapshot excludes starting a Session offers no New Session affordance.
    const canStartSession = useRemoteAccess('session/create');
    const toggleLabel = collapsed ? t('toggle.open') : t('toggle.collapse');
    // Wide content stays mounted while the collapse animates (fading via
    // .collapsed .wide), unmounts at settle, and remounts right away on expand.
    // A closed drawer retains its content with the rail phase already settled.
    const [settled, setSettled] = useState(collapsed);
    useEffect(() => {
        if (drawer || !collapsed) {
            setSettled(collapsed);
            return;
        }
        const timer = window.setTimeout(() => { setSettled(true); }, COLLAPSE_SETTLE_MS);
        return () => { window.clearTimeout(timer); };
    }, [collapsed, drawer]);
    const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar');
    const wide = drawer || (windowsTitlebar ? !collapsed : !collapsed || !settled);
    const [scrollHandoff] = useState(createScrollHandoff);
    const sectionHookContext = useMemo(() => ({ useSectionScroller: scrollHandoff.useSectionScroller }), [scrollHandoff]);
    // The Windows titlebar hosts the New Session controls while the sidebar is collapsed.
    const openNewSession = () => {
        trackEntryClick({ menu_name: 'new_session', position: windowsTitlebar && collapsed ? 'titlebar' : 'sidebar' });
        startSession();
    };
    // The Windows caption menus occupy the strip to the right of these controls
    // (that is what --dsh-windows-menu-start reserves), so a right-side bubble
    // lands under their text. Below the caption is the only clear side.
    const captionTooltipSide = windowsTitlebar ? 'bottom' : 'right';
    // Freeze the content at its expanded width while it fades out (collapsed
    // && wide): the sliding column then clips it instead of reflowing it. The
    // rail layout (.collapsed styles) only applies once the fade settles.
    const lastWideWidth = useRef(width);
    if (drawer || !collapsed)
        lastWideWidth.current = width;
    // A closed drawer returns to the static rail; only a live collapse fades it in.
    const animateRail = useRef(!collapsed);
    if (drawer || !collapsed)
        animateRail.current = !collapsed;
    // Scrollbars in the column follow the pointer (.quietBars rebinds them
    // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
    // leaves. A pointer that returns within that window cancels the pending
    // hide rather than restarting from a hidden bar.
    const column = useRef(null);
    const sidebarFocus = useRef(null);
    useModalLayer(column, drawer && !collapsed, toggleSidebar);
    useLayoutEffect(() => {
        if (!collapsed)
            return;
        const controlled = sidebarFocus.current?.getAttribute('aria-controls')?.split(/\s+/) ?? [];
        const ownsMenuFocus = controlled.some(id => document.getElementById(id)?.contains(document.activeElement));
        if (sidebarFocus.current !== document.activeElement && !ownsMenuFocus)
            return;
        const opener = drawer
            ? column.current?.ownerDocument.querySelector('[data-sidebar-opener]')
            : column.current?.querySelector('[data-sidebar-toggle]');
        if (opener != null && !isBehindModal(opener))
            focusWithoutRing(opener, { preventScroll: true });
    }, [drawer, collapsed]);
    const [pointerInside, setPointerInside] = useState(false);
    const lingerTimer = useRef(undefined);
    const armLinger = () => {
        if (lingerTimer.current !== undefined)
            return;
        lingerTimer.current = window.setTimeout(() => {
            lingerTimer.current = undefined;
            setPointerInside(false);
        }, SCROLLBAR_LINGER_MS);
    };
    const cancelLinger = () => {
        window.clearTimeout(lingerTimer.current);
        lingerTimer.current = undefined;
    };
    // Leaving is decided by the column's BOX, not by DOM containment, and only
    // while the bars are drawn. ui-settings renders its full-viewport panel as a
    // fixed-position DESCENDANT of this column, so a pointer moved onto that
    // panel — or onto the conversation once it closes — fires no `pointerleave`
    // here, and the bars would stay drawn over a column nobody is pointing at.
    // The element's own leave stays as the one signal geometry cannot give: a
    // pointer that leaves the window emits no further moves.
    useEffect(() => {
        if (!pointerInside)
            return;
        const onMove = (event) => {
            const rect = column.current?.getBoundingClientRect();
            /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
            if (rect === undefined)
                return;
            const inside = event.clientX >= rect.left && event.clientX < rect.right
                && event.clientY >= rect.top && event.clientY < rect.bottom;
            if (inside)
                cancelLinger();
            else
                armLinger();
        };
        document.addEventListener('pointermove', onMove);
        return () => {
            document.removeEventListener('pointermove', onMove);
            cancelLinger();
        };
    }, [pointerInside]);
    const buildVersion = localBuildVersion();
    // The local-build fallbacks copy the badge text; the brand button below
    // skips New Session for clicks inside them. The click still bubbles, so
    // document-level outside-click listeners see it.
    // Each successful copy bumps the key so a repeated copy replays the toast.
    const [copiedToast, setCopiedToast] = useState(null);
    const copyVersion = (version) => () => {
        void writeClipboard(version).then((ok) => {
            if (ok)
                setCopiedToast(seq => (seq ?? 0) + 1);
        });
    };
    const darwinDesktop = isDarwinDesktop();
    // Rail resting state is the whale mark; hovering swaps in the panel icon
    // (the expand affordance, figma sidebar-hover flow). Expanded it is a plain
    // panel icon.
    const toggle = (_jsx(Tooltip, { label: toggleLabel, shortcutKeys: shortcut?.keys, delayMs: 500, side: captionTooltipSide, portal: drawer, children: _jsxs("button", { "data-sidebar-toggle": true, "data-modal-autofocus": drawer || undefined, type: "button", className: clsx(css.iconButton, css.toggle), "aria-label": toggleLabel, "aria-keyshortcuts": shortcut?.aria, onClick: () => { toggleSidebar(); }, children: [!wide && !windowsTitlebar && (_jsx("span", { className: css.railMark, "aria-hidden": "true", children: renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: _jsx(FishLogo, { size: 24 }) }) })), _jsx(IconPanelLeftOutlineRegular, { className: css.panelIcon, size: wide || windowsTitlebar ? 16 : 18 }), !wide && renderSlot('sidebar.toggle.badge', {})] }) }));
    return (_jsxs("div", { ref: column, onFocusCapture: (event) => { sidebarFocus.current = event.target; }, role: drawer ? 'dialog' : undefined, "data-shortcut-modal": drawer ? 'sidebar' : undefined, "aria-modal": drawer && !collapsed ? true : undefined, "aria-label": drawer ? t('navigation.label') : undefined, tabIndex: drawer ? -1 : undefined, className: clsx(css.root, !wide && css.collapsed, !wide && animateRail.current && css.railIn, !drawer && collapsed && wide && css.fading, !pointerInside && css.quietBars), style: wide ? { width: !drawer && collapsed ? lastWideWidth.current : width } : undefined, onPointerEnter: () => {
            cancelLinger();
            setPointerInside(true);
        }, onPointerLeave: () => { armLinger(); }, children: [darwinDesktop && _jsx("div", { className: css.topStrip, "data-window-drag": true, children: !wide && toggle }), _jsxs("div", { className: css.logoRow, "data-window-drag": true, children: [wide && (() => {
                        const identity = (_jsxs("span", { className: css.brandIdentity, "aria-hidden": "true", children: [_jsx("span", { className: css.brandMark, children: renderSlot('sidebar.brand.mark', { size: 24 }, {
                                        fallback: buildVersion === undefined
                                            ? _jsx(FishLogo, { size: 24 })
                                            : _jsx("span", { className: css.copyVersion, "data-copy-version": true, onClick: copyVersion(buildVersion), children: _jsx(FishLogo, { size: 24 }) }),
                                    }) }), _jsx("span", { className: css.brandName, children: renderSlot('sidebar.brand.name', {}, {
                                        fallback: buildVersion === undefined
                                            ? _jsx("span", { className: css.fallbackBrandName, children: t('brand.localBuild') })
                                            : (_jsxs("span", { className: clsx(css.localBuildBrand, css.copyVersion), "data-copy-version": true, onClick: copyVersion(buildVersion), children: [_jsx("span", { className: css.localBuildTitle, children: t('brand.localBuild') }), _jsx("span", { className: css.buildVersion, children: buildVersion })] })),
                                    }) })] }));
                        return darwinDesktop || !canStartSession
                            ? _jsx("span", { className: clsx(css.brand, css.wide), children: identity })
                            : (_jsx("button", { type: "button", className: clsx(css.brand, css.wide), "aria-label": t('session.new.label'), "aria-keyshortcuts": newShortcut?.aria, onClick: (event) => {
                                    if (event.target.closest('[data-copy-version]') !== null)
                                        return;
                                    openNewSession();
                                }, children: identity }));
                    })(), wide && pluginsPanel !== undefined && (_jsx(Tooltip, { label: pluginsPanel.label, delayMs: 500, side: "bottom", portal: true, children: _jsx("button", { type: "button", className: clsx(css.iconButton, css.pluginsButton), "aria-label": pluginsPanel.label, "aria-current": activePanelId === pluginsPanel.id ? 'page' : undefined, onClick: () => {
                                trackEntryClick({ menu_name: 'plugin', position: 'sidebar' });
                                selectPanel(pluginsPanel.id);
                            }, children: _jsx("span", { className: css.panelGlyph, "aria-hidden": "true", children: renderFactorySlot('sidebar.panel.icon', { id: pluginsPanel.id, size: 16, active: activePanelId === pluginsPanel.id }) }) }) })), wide && headerPanels.map(panel => (_jsx(Tooltip, { label: panel.label, delayMs: 500, side: "bottom", portal: true, children: _jsx("button", { type: "button", className: clsx(css.iconButton, css.pluginsButton), "aria-label": panel.label, "aria-current": activePanelId === panel.id ? 'page' : undefined, onClick: () => { selectPanel(panel.id); }, children: _jsx("span", { className: css.panelGlyph, "aria-hidden": "true", children: renderFactorySlot('sidebar.panel.icon', { id: panel.id, size: 16, active: activePanelId === panel.id }) }) }) }, panel.id))), (!darwinDesktop || wide) && toggle] }), canStartSession && (_jsx("div", { className: css.newSessionRow, children: renderSlot('sidebar.session.action', { wide }, {
                    children: !wide && (_jsx(Tooltip, { label: t('session.new.label'), shortcutKeys: newShortcut?.keys, delayMs: 500, side: captionTooltipSide, disabled: wide, children: _jsx("button", { type: "button", className: css.newSession, "aria-label": t('session.new.label'), "aria-keyshortcuts": newShortcut?.aria, onClick: openNewSession, children: _jsx("span", { className: css.newSessionLabelMask, children: _jsx("span", { className: css.newSessionContent, children: _jsx(IconNewChatOutlineRegular, { size: windowsTitlebar ? 16 : 18 }) }) }) }) })),
                }) })), _jsxs("div", { className: css.scrollRegion, children: [_jsxs("div", { ref: scrollHandoff.bindViewportRef, className: css.scrollArea, "data-sidebar-scrollport": wide ? '' : undefined, children: [panels.length > 0 && (_jsx("nav", { className: css.panelList, "aria-label": t('panels.label'), children: panels.filter(({ id }) => (id === FIXED_PANEL_ID || HEADER_PANEL_IDS.includes(id) ? !wide : NAV_PANEL_IDS.includes(id)))
                                    .map(({ id, label }) => (_jsx(PanelRow, { id: id, label: label, wide: wide, unpinLabel: t('panels.unpin', { name: label }), unpinTooltip: t('panels.unpinTooltip'), canUnpin: false, setPinned: setPinned, usePanelInfo: usePanelInfo, selectPanel: selectPanel, trackEntryClick: trackEntryClick, renderFactorySlot: renderFactorySlot }, id))) })), _jsx("div", { className: css.regionArea, children: renderSlot('sidebar.workspaces', {
                                    wide,
                                    expandSidebar: () => { if (collapsed)
                                        toggleSidebar(); },
                                }, { hookContext: sectionHookContext }) })] }), _jsx("span", { className: css.scrollFade, "aria-hidden": "true" })] }), copiedToast !== null && (_jsx(Toast, { tone: "success", text: t('version.copied'), onDone: () => { setCopiedToast(null); } }, copiedToast)), _jsxs("div", { className: css.footArea, children: [_jsx("div", { className: css.footerActions, children: renderSlot('sidebar.footer.action', { wide }) }), _jsx("div", { className: css.settingsArea, children: renderSlot('sidebar.settings', { wide }) })] })] }));
}
//# sourceMappingURL=SidebarRoot.js.map
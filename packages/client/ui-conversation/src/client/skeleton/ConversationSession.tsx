/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { orderedViewTabs } from '../view-tabs.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/** One View tab label; the tab strip scrolls instead of clipping labels away. */
function ViewTabLabel({ label }: { readonly label: string }) {
  return <span className={css.tabLabel}>{label}</span>
}

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Views that only make sense while the Session has child (subagent) sessions:
 * the tab stays hidden until a subagent is delegated, and reappears on demand.
 */
const SUBAGENT_VIEW_IDS: readonly string[] = ['fleet']

/** Whether any child Session (a delegated subagent) belongs to this Session. */
function hasChildSessions(list: SessionListState, sessionId: SessionId): boolean {
  for (const summary of Object.values(list.byId)) {
    if (summary.origin === 'subagent' && summary.parentId === sessionId) return true
  }
  return false
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, hideChrome, useSessions, useConversationViews, useStore,
  renderSlot, renderFactorySlot, open, useContextMenu, selectView, t, useViewTabs,
}: ConversationSessionHeaderProps) {
  const { getTriggerProps } = useContextMenu()
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const hasChildSessionsForTab = useSessions(s => hasChildSessions(s, sessionId))
  const order = useViewTabs(selection => selection)
  const headerTabs = orderedViewTabs(tabs, order)
    .filter(viewTab => !SUBAGENT_VIEW_IDS.includes(viewTab.id) || hasChildSessionsForTab || viewTab.id === selectedId)
  const active = resolveActiveView(headerTabs, selectedId)
  const showTabs = !hideChrome && tabs.length > 1
  const hasVisibleSubagentView = showTabs && headerTabs.some(viewTab => viewTab.id === 'fleet')
  return (
    <>
      <div className={css.titleRow}>
        {!hideChrome && (
          <>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  // The current crumb has no navigation, so it is plain text
                  // rather than a disabled button: on darwin desktop a button
                  // would subtract itself from the header's drag row (ui-web
                  // base.css) and leave the title inert for dragging too.
                  const title = last
                    ? (
                      <span className={clsx(css.crumb, css.crumbCurrent)}>
                        {summary.displayTitle}
                      </span>
                    )
                    : (
                      <button
                        type="button"
                        className={css.crumb}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg} {...getTriggerProps({ kind: 'session', value: { sessionId: summary.id, displayTitle: summary.displayTitle } })}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
            </div>
            {!showTabs && (
              // Keep single-View actions outside the title's clipping and
              // fade, so shrinking the title cannot hide their hit targets.
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', { hasVisibleSubagentView })}
              </div>
            )}
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
              {renderFactorySlot('contextMenu.button', {
                target: { kind: 'sessionHeader', value: { sessionId } },
                label: t('header.more'), className: css.headerMenuButton, size: 'sm',
              })}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
      {showTabs && (
        // data-conversation-tabs: marks the tab strip, which the window-chrome
        // geometry and the browser coverage lane anchor on.
        <div className={css.tabs}>
          <div className={clsx(css.viewTabs, css.viewTabsScroll)} role="tablist" data-conversation-tabs="">
            {headerTabs.map(viewTab => (
              <button
                key={viewTab.id}
                type="button"
                role="tab"
                aria-selected={viewTab.id === active?.id}
                className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                onClick={() => { selectView(viewTab.id) }}
              >
                <ViewTabLabel label={viewTab.label} />
              </button>
            ))}
          </div>
          <div className={css.tabActions}>
            {renderSlot('conversation.session.header.actions', { hasVisibleSubagentView })}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}

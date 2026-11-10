/** General Settings row for choosing and ordering the Conversation View tabs kept in the header. */
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ViewTab } from '../contract/views.ts'
import type { ViewTabSelection } from '../../submission-settings.ts'
import { FIXED_VIEW_ID, preferredViewTabs } from '../view-tabs.ts'
import css from './ViewTabsRow.module.css'

/** Registration-side View tab preference faces. */
export interface ViewTabsRowInjected {
  hooks: {
    /** Ordered View ids kept outside More; null keeps the automatic width-based layout. */
    readonly viewTabs: ObservableSnapshot<ViewTabSelection>
    /** Registered Views in registration order. */
    readonly conversationViews: ObservableSnapshot<readonly ViewTab[]>
  }
  /** Replace the profile's ordered visible View ids. */
  readonly setViewTabs: (ids: readonly string[]) => void
}

/** Full Settings-row props. */
export type ViewTabsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ViewTabsRowInjected>

/** One configurable View row: identity, current visibility, and its position among the visible ones. */
interface ViewRow {
  readonly view: ViewTab
  readonly visible: boolean
  readonly position: number
}

/**
 * Collect the configurable View rows: visible Views in their chosen order,
 * then registered Views the choice does not mention, still hidden.
 * @param views - Registered Views in registration order.
 * @param selection - Ordered visible ids, or null for the automatic layout.
 * @returns Rows for every non-fixed View.
 */
function viewRows(views: readonly ViewTab[], selection: ViewTabSelection): readonly ViewRow[] {
  const ordered = preferredViewTabs(views, selection).filter(view => view.id !== FIXED_VIEW_ID)
  const listed = new Set(ordered.map(view => view.id))
  return [
    ...ordered.map((view, position) => ({ view, visible: true, position })),
    ...views.filter(view => view.id !== FIXED_VIEW_ID && !listed.has(view.id))
      .map(view => ({ view, visible: false, position: -1 })),
  ]
}

/**
 * Render the header View tab chooser: the fixed View, then every configurable
 * View with a visibility toggle and order buttons.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ViewTabsRow({
  useViewTabs, useConversationViews, setViewTabs, t,
}: ViewTabsRowProps) {
  const selection = useViewTabs(value => value)
  const views = useConversationViews(value => value)
  const rows = viewRows(views, selection)
  const visibleIds = rows.filter(row => row.visible).map(row => row.view.id)
  const fixed = views.find(view => view.id === FIXED_VIEW_ID)
  const commit = (ids: readonly string[]): void => { setViewTabs(ids) }
  const row = ({ view, visible, position }: ViewRow): ReactNode => (
    <li key={view.id} className={css.item}>
      <button
        type="button"
        className={css.toggle}
        aria-pressed={visible}
        aria-label={t(visible ? 'settings.viewTabs.hide' : 'settings.viewTabs.show', { name: view.label })}
        onClick={() => {
          commit(visible ? visibleIds.filter(id => id !== view.id) : [...visibleIds, view.id])
        }}
      >
        {visible && <IconCheckOutlineRegular size={12} />}
      </button>
      <span className={css.label}>{view.label}</span>
      {visible && (
        <span className={css.order}>
          <button
            type="button"
            className={css.orderButton}
            disabled={position === 0}
            aria-label={t('settings.viewTabs.moveUp', { name: view.label })}
            onClick={() => {
              if (position <= 0) return
              const next = [...visibleIds]
              next[position] = visibleIds[position - 1]!
              next[position - 1] = view.id
              commit(next)
            }}
          >
            <IconChevronUpOutlineRegular size={14} />
          </button>
          <button
            type="button"
            className={css.orderButton}
            disabled={position === visibleIds.length - 1}
            aria-label={t('settings.viewTabs.moveDown', { name: view.label })}
            onClick={() => {
              if (position < 0 || position >= visibleIds.length - 1) return
              const next = [...visibleIds]
              next[position] = visibleIds[position + 1]!
              next[position + 1] = view.id
              commit(next)
            }}
          >
            <IconChevronDownOutlineRegular size={14} />
          </button>
        </span>
      )}
    </li>
  )
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.viewTabs.title')}</div>
        <div className={css.desc}>{t('settings.viewTabs.description')}</div>
      </div>
      <ul className={css.list} aria-label={t('settings.viewTabs.title')}>
        {fixed !== undefined && (
          <li className={css.item}>
            <span className={css.fixedMark}><IconCheckOutlineRegular size={12} /></span>
            <span className={css.label}>{fixed.label}</span>
            <span className={css.fixedTag}>{t('settings.viewTabs.fixed')}</span>
          </li>
        )}
        {rows.map(row)}
      </ul>
    </div>
  )
}

/** General Settings row for ordering the Conversation View tabs in the Session header. */
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ViewTab } from '../contract/views.ts'
import type { ViewTabSelection } from '../../submission-settings.ts'
import { FIXED_VIEW_ID, orderedViewTabs } from '../view-tabs.ts'
import css from './ViewTabsRow.module.css'

/** Registration-side View tab preference faces. */
export interface ViewTabsRowInjected {
  hooks: {
    /** Ordered View ids; ids not listed follow in registration order. */
    readonly viewTabs: ObservableSnapshot<ViewTabSelection>
    /** Registered Views in registration order. */
    readonly conversationViews: ObservableSnapshot<readonly ViewTab[]>
  }
  /** Replace the profile's ordered View ids. */
  readonly setViewTabs: (ids: readonly string[]) => void
}

/** Full Settings-row props. */
export type ViewTabsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ViewTabsRowInjected>

/** One configurable View row: identity and its position among the configurable Views. */
interface ViewRow {
  readonly view: ViewTab
  readonly position: number
}

/**
 * Collect the configurable View rows in header order, excluding the fixed View.
 * @param views - Registered Views in registration order.
 * @param selection - Ordered View ids, or null for registration order.
 * @returns Rows for every non-fixed View.
 */
function viewRows(views: readonly ViewTab[], selection: ViewTabSelection): readonly ViewRow[] {
  return orderedViewTabs(views, selection)
    .filter(view => view.id !== FIXED_VIEW_ID)
    .map((view, position) => ({ view, position }))
}

/**
 * Render the header View tab order: the fixed View, then every configurable
 * View with up and down buttons. Every View keeps a tab, so the row only
 * chooses position and never visibility.
 * @param props - composed Settings slot props.
 * @returns the ordering row.
 */
export function ViewTabsRow({
  useViewTabs, useConversationViews, setViewTabs, t,
}: ViewTabsRowProps) {
  const selection = useViewTabs(value => value)
  const views = useConversationViews(value => value)
  const rows = viewRows(views, selection)
  const orderedIds = rows.map(row => row.view.id)
  const fixed = views.find(view => view.id === FIXED_VIEW_ID)
  const move = (position: number, offset: -1 | 1): void => {
    const target = position + offset
    if (position < 0 || target < 0 || target >= orderedIds.length) return
    const moved = orderedIds[position]
    const displaced = orderedIds[target]
    if (moved === undefined || displaced === undefined) return
    const next = [...orderedIds]
    next[position] = displaced
    next[target] = moved
    setViewTabs(next)
  }
  const row = ({ view, position }: ViewRow): ReactNode => (
    <li key={view.id} className={css.item}>
      <span className={css.mark} aria-hidden="true" />
      <span className={css.label}>{view.label}</span>
      <span className={css.order}>
        <button
          type="button"
          className={css.orderButton}
          disabled={position === 0}
          aria-label={t('settings.viewTabs.moveUp', { name: view.label })}
          onClick={() => { move(position, -1) }}
        >
          <IconChevronUpOutlineRegular size={14} />
        </button>
        <button
          type="button"
          className={css.orderButton}
          disabled={position === orderedIds.length - 1}
          aria-label={t('settings.viewTabs.moveDown', { name: view.label })}
          onClick={() => { move(position, 1) }}
        >
          <IconChevronDownOutlineRegular size={14} />
        </button>
      </span>
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

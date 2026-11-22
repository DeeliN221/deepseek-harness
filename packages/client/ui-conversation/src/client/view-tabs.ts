/** Profile-backed ordering of the Conversation View tabs in the Session header. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConversationSettings, ViewTabSelection } from '../submission-settings.ts'
import { VIEW_TABS_FIELD } from '../submission-settings.ts'
import type { ViewTab } from './contract/views.ts'

/** View whose tab always leads the header and never joins the customization list. */
export const FIXED_VIEW_ID = 'chat'

/**
 * The ordered View ids shared by every Session in the active profile.
 * The value is the `ui-conversation` configuration form's `viewTabs` field, so
 * a deployment default comes from the profile patch while user changes persist
 * through the same form and reach every browser of that profile.
 *
 * The list is an order, not a visibility filter: every registered View keeps a
 * header tab and the ids these values mention are placed first. Views the list
 * does not mention follow in registration order, so a newly installed plugin is
 * reachable without touching Settings.
 */
export class ViewTabsPreference {
  /** Ordered View ids; null keeps registration order after the fixed View. */
  readonly order: SnapshotStore<ViewTabSelection> = createSnapshotStore<ViewTabSelection>(null)
  private readonly unsubscribe: (() => void) | undefined
  private readonly host: ConfigForm<ConversationSettings> | undefined

  /**
   * @param host - Shared configuration form; omitted keeps registration order.
   */
  constructor(host?: ConfigForm<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      this.unsubscribe = host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /** Release the configuration subscription. */
  dispose(): void { this.unsubscribe?.() }

  /**
   * Replace the ordered View ids.
   * @param ids - Ordered ids excluding the fixed View.
   */
  setOrder(ids: readonly string[]): void {
    if (sameIds(this.order.getSnapshot(), ids)) return
    this.order.set(ids)
    void this.host?.set(VIEW_TABS_FIELD, ids)
  }

  /**
   * Adopt the form's accepted value without writing it back.
   * @param host - the constructor-narrowed form driving this adoption.
   */
  private adopt(host: ConfigForm<ConversationSettings>): void {
    const section = host.getSnapshot().value
    const next = section?.[VIEW_TABS_FIELD] ?? null
    if (sameSelection(this.order.getSnapshot(), next)) return
    this.order.set(next)
  }
}

/**
 * Whether two ordered id lists are identical.
 * @param left - First selection.
 * @param right - Second selection.
 * @returns true for the same length and order.
 */
function sameIds(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((id, index) => id === right.at(index))
}

/**
 * Whether two selections are identical.
 * @param left - First selection.
 * @param right - Second selection.
 * @returns true for equal ids in equal order.
 */
function sameSelection(left: ViewTabSelection, right: ViewTabSelection): boolean {
  return sameIds(left ?? null, right ?? null)
}

/**
 * Resolve the header tab order.
 *
 * The fixed View leads whenever it is registered. The remaining Views follow
 * either the ordered selection or, while it is unset, registration order; ids
 * the selection does not mention keep their registration order after it, so a
 * newly registered View is always reachable and only its position is a choice.
 * Ids of Views that are no longer registered are skipped.
 * @param tabs - Registered Views in registration order.
 * @param order - Ordered ids, or null for registration order.
 * @returns Every registered View in header order.
 */
export function orderedViewTabs(
  tabs: readonly ViewTab[],
  order: ViewTabSelection,
): readonly ViewTab[] {
  const fixed = tabs.find(tab => tab.id === FIXED_VIEW_ID)
  const rest = tabs.filter(tab => tab.id !== FIXED_VIEW_ID)
  if (order === null) return fixed === undefined ? rest : [fixed, ...rest]
  const listed = new Set(order)
  const ordered = order.flatMap((id) => {
    const tab = rest.find(candidate => candidate.id === id)
    return tab === undefined ? [] : [tab]
  })
  const appended = rest.filter(tab => !listed.has(tab.id))
  const tail = [...ordered, ...appended]
  return fixed === undefined ? tail : [fixed, ...tail]
}

/** Profile-backed choice of the Conversation View tabs shown in the Session header. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConversationSettings, ViewTabSelection } from '../submission-settings.ts'
import { VIEW_TABS_FIELD } from '../submission-settings.ts'
import type { ViewTab } from './contract/views.ts'

/** View whose tab always shows and never joins the customization list. */
export const FIXED_VIEW_ID = 'chat'

/**
 * The ordered visible View ids shared by every Session in the active profile.
 * The value is the `ui-conversation` configuration form's `viewTabs` field, so
 * a deployment default comes from the profile patch while user changes persist
 * through the same form and reach every browser of that profile.
 */
export class ViewTabsPreference {
  /** Ordered visible View ids; null keeps the automatic width-based layout. */
  readonly visible: SnapshotStore<ViewTabSelection> = createSnapshotStore<ViewTabSelection>(null)
  private readonly unsubscribe: (() => void) | undefined
  private readonly host: ConfigForm<ConversationSettings> | undefined

  /**
   * @param host - Shared configuration form; omitted keeps the browser-local automatic layout.
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
   * Replace the ordered visible View ids.
   * @param ids - Ordered visible ids excluding the fixed View; an empty list keeps only the fixed View.
   */
  setVisible(ids: readonly string[]): void {
    if (sameIds(this.visible.getSnapshot(), ids)) return
    this.visible.set(ids)
    void this.host?.set(VIEW_TABS_FIELD, ids)
  }

  /**
   * Adopt the form's accepted value without writing it back.
   * @param host - the constructor-narrowed form driving this adoption.
   */
  private adopt(host: ConfigForm<ConversationSettings>): void {
    const section = host.getSnapshot().value
    const next = section?.[VIEW_TABS_FIELD] ?? null
    if (sameSelection(this.visible.getSnapshot(), next)) return
    this.visible.set(next)
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
 * Resolve the Views kept outside More.
 *
 * The fixed View leads whenever it is registered; the remaining Views follow
 * either the ordered selection or, while it is unset, registration order. Ids
 * of Views that are no longer registered are skipped.
 * @param tabs - Registered Views in registration order.
 * @param visibleIds - Ordered visible ids, or null for the automatic layout.
 * @returns Ordered Views eligible for the header.
 */
export function preferredViewTabs(
  tabs: readonly ViewTab[],
  visibleIds: ViewTabSelection,
): readonly ViewTab[] {
  const fixed = tabs.find(tab => tab.id === FIXED_VIEW_ID)
  const rest = visibleIds === null
    ? tabs.filter(tab => tab.id !== FIXED_VIEW_ID)
    : visibleIds.flatMap((id) => {
      const tab = tabs.find(candidate => candidate.id === id)
      return tab === undefined || tab.id === FIXED_VIEW_ID ? [] : [tab]
    })
  return fixed === undefined ? rest : [fixed, ...rest]
}

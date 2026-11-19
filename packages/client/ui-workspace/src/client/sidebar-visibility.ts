/** Sidebar-only projections. Never change the Session catalog or access policy. */
import type { SessionListState, SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Keep only explicitly unhidden rows; unknown provenance always stays visible. */
export function sidebarList(list: SessionListState, hidden: readonly SessionId[]): SessionListState {
  if (hidden.length === 0) return list
  const ids = new Set(hidden)
  return { ...list, ids: list.ids.filter(id => !ids.has(id)),
    byId: Object.fromEntries(Object.entries(list.byId).filter(([id]) => !ids.has(id as SessionId))) }
}

/** Cold search hits obey the same policy as loaded rows. */
export function sidebarSearch(items: readonly SessionSearchResultItem[], hidden: readonly SessionId[]): readonly SessionSearchResultItem[] {
  const ids = new Set(hidden)
  return items.filter(item => !ids.has(item.sessionId))
}

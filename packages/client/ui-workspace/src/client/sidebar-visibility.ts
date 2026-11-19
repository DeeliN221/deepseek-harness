/** Sidebar-only projections. Never change the Session catalog or access policy. */
import type { SessionListState, SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Arrays are legacy exclusions. A coverage snapshot withholds only unclassified rows until its request settles. */
export type SidebarPolicy = readonly SessionId[] | {
  readonly hiddenSessionIds: readonly SessionId[]
  readonly coveredSessionIds: readonly SessionId[]
  readonly ready?: boolean
}

function policySets(policy: SidebarPolicy): { hidden: Set<SessionId>; covered?: Set<SessionId> } {
  if ('hiddenSessionIds' in policy) return { hidden: new Set(policy.hiddenSessionIds), covered: new Set(policy.coveredSessionIds) }
  return { hidden: new Set(policy) }
}

/** Combine independent providers without letting a ready provider unlock another provider's pending rows. */
export function mergeSidebarPolicies(policies: readonly SidebarPolicy[]): SidebarPolicy {
  const hidden = new Set<SessionId>()
  let covered: Set<SessionId> | undefined
  for (const policy of policies) {
    const next = policySets(policy)
    for (const id of next.hidden) hidden.add(id)
    if (next.covered !== undefined) {
      covered = covered === undefined ? next.covered : new Set([...covered].filter(id => next.covered?.has(id)))
    }
  }
  return covered === undefined ? [...hidden] : { hiddenSessionIds: [...hidden], coveredSessionIds: [...covered], ready: policies.every(policy => !('hiddenSessionIds' in policy) || policy.ready !== false) }
}

/** Pending classification never modifies the source list or permanently excludes an ordinary conversation. */
export function sidebarList(list: SessionListState, policy: SidebarPolicy): SessionListState {
  const { hidden, covered } = policySets(policy)
  if (hidden.size === 0 && covered === undefined) return list
  const visible = (id: SessionId): boolean => !hidden.has(id) && (covered === undefined || covered.has(id))
  return { ...list, phase: covered?.size === 0 && list.ids.length > 0 ? 'pending' : list.phase,
    ids: list.ids.filter(visible),
    byId: Object.fromEntries(Object.entries(list.byId).filter(([id]) => visible(id as SessionId))) }
}

/** Cold search hits obey the same coverage fence as loaded rows. */
export function sidebarSearch(items: readonly SessionSearchResultItem[], policy: SidebarPolicy): readonly SessionSearchResultItem[] {
  const { hidden, covered } = policySets(policy)
  // The authenticated index includes exclusions for cold/archived sessions too.
  // Coverage fences the live roster, not the independent historical search index.
  if (covered !== undefined && 'ready' in policy && policy.ready === false) return []
  return items.filter(item => !hidden.has(item.sessionId))
}

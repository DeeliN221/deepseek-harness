/** Shared provider display order for the composer and command model pickers. */

/**
 * Display preference only. Provider order never moves an existing Session and
 * implements no failover: Magpie's `auto/...`/`group/...` routing groups own
 * failover, and they are listed first so those real routes stay visible.
 */
function providerRank(id: string): number {
  if (id === 'dsh-magpie-connector-routing') return 0
  if (id === 'deepseek-account') return 1
  if (id === 'deepseek-official') return 2
  if (/personal/i.test(id)) return 9
  return 3
}

/**
 * Keep Magpie routing groups and the official providers first, and push the
 * personal key last so a personal key is never the default-looking choice.
 * Every other relative order is preserved.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) => providerRank(left.id) - providerRank(right.id))
}

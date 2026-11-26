/**
 * Display-time model grouping: ONE row per model id across providers.
 *
 * The Host catalog advertises one group per provider, and a gateway-backed
 * deployment registers one route per upstream owner, so the same model id can
 * arrive through several providers. The selector therefore collapses every
 * ordinary provider group into a single provider-free list keyed by model id,
 * while each row keeps the provider that must receive its request. External
 * Agent engines (`acp:*`) are subscription runtimes with their own model
 * semantics, so those groups keep their identity and their provider heading.
 */
import type {
  ModelCatalogModel, ModelProviderGroup, ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { orderModelProviders } from './provider-order.ts'

/** Provider-group id prefix the Host reserves for External Agent engines. */
export const ACP_GROUP_PREFIX = 'acp:'

/**
 * Provider group the Magpie connector reserves for routing entries
 * (`auto/...`, `group/...`). Those entries are real failover routes, not a
 * vendor duplicate, so they are never folded into a vendor row.
 */
export const MAGPIE_ROUTING_PROVIDER = 'dsh-magpie-connector-routing'

/** Section id of the merged, provider-free list. */
export const MERGED_GROUP_ID = 'merged'

/** One selectable model row and the provider its request routes to. */
export interface DisplayModel {
  /** Catalog entry of {@link DisplayModel.route}; supplies the row's reasoning metadata. */
  readonly model: ModelCatalogModel
  /** Provider that receives the request for this row. */
  readonly route: string
  /** Every provider offering this model id, each with its own catalog entry. */
  readonly providers: ReadonlyMap<string, ModelCatalogModel>
}

/** One rendered section of the model list. */
export interface DisplayGroup {
  /** Section identity: {@link MERGED_GROUP_ID} or the provider id of an engine group. */
  readonly id: string
  /** Provider-authored section name; empty for the merged section. */
  readonly name: string
  /** Rows of this section in display order. */
  readonly models: readonly ModelCatalogModel[]
  /** Whether this section merges rows by model id and shows no provider identity. */
  readonly merged: boolean
  /**
   * Provider that receives the request for one row of this section.
   * @param modelId - the row's model id.
   * @returns the route provider, or undefined for an id this section does not hold.
   */
  readonly routeOf: (modelId: string) => string | undefined
  /**
   * Whether this section's row for a model id accepts one provider as its route.
   * Distinct from {@link routeOf}: a merged row accepts every duplicate provider,
   * while a routing/vendor row accepts only its own group.
   * @param modelId - the row's model id.
   * @param provider - candidate provider.
   * @returns true when that provider owns a route for the row.
   */
  readonly hasRoute: (modelId: string, provider: string) => boolean
  /**
   * Catalog entry one row's metadata is read from, preferring a given provider.
   * @param modelId - the row's model id.
   * @param provider - preferred provider, normally the Session's current one.
   * @returns that provider's own entry, else the routed entry; undefined for an unknown id.
   */
  readonly entryOf: (modelId: string, provider: string | undefined) => ModelCatalogModel | undefined
}

/** Mutable accumulation row; `providers` only grows while the catalog is folded. */
interface PendingRow {
  model: ModelCatalogModel
  route: string
  providers: Map<string, ModelCatalogModel>
}

/**
 * Whether a provider group belongs to an External Agent engine rather than to a model route.
 * @param id - provider group id.
 * @returns true for the `acp:` engine groups, whose rows never merge.
 */
export function isEngineGroup(id: string): boolean {
  return id.startsWith(ACP_GROUP_PREFIX)
}

/**
 * Fold provider groups into the selector's display sections.
 *
 * Ordinary providers are ordered first, then folded by exact model id: the first
 * provider in that order wins the request, unless the Session already uses one
 * of the duplicates, which keeps a working route instead of silently moving it.
 * A different model id is never folded, even when two models share a display
 * name; version punctuation (V4.1 vs V41) therefore cannot collide. Magpie
 * routing entries are not folded at all: they keep their own section so a
 * routing id and a vendor id can never overwrite each other's route.
 * Duplicate entries keep every provider's own metadata so reasoning levels stay
 * exact for the provider that is actually in use.
 * @param groups - provider groups of the loaded Host catalog.
 * @param current - the Session's saved selection, or null while unresolved.
 * @returns the merged section (when it holds rows) followed by engine groups.
 */
export function groupModelsForDisplay(
  groups: readonly ModelProviderGroup[],
  current: ModelSelection | null,
): readonly DisplayGroup[] {
  const rows = new Map<string, PendingRow>()
  const byId = new Map<string, PendingRow>()
  for (const group of orderModelProviders(groups.filter(group => !isEngineGroup(group.id) && group.id !== MAGPIE_ROUTING_PROVIDER))) {
    for (const model of group.models) {
      // Key by the exact model id. Folding by display name merged unrelated ids
      // and lost the duplicate's route; routing groups are handled in their own
      // section below and never enter this map.
      const key = `id:${model.id}`
      const pending = rows.get(key)
      if (pending === undefined) {
        const row: PendingRow = { model, route: group.id, providers: new Map([[group.id, model]]) }
        rows.set(key, row)
        byId.set(model.id, row)
        continue
      }
      pending.providers.set(group.id, model)
      byId.set(model.id, pending)
    }
  }

  const kept = current === null ? undefined : byId.get(current.model)?.providers.get(current.provider)
  if (kept !== undefined && current !== null) {
    const pending = byId.get(current.model)
    if (pending !== undefined) {
      pending.route = current.provider
      pending.model = kept
    }
  }

  const sections: DisplayGroup[] = []
  if (rows.size > 0) {
    sections.push({
      id: MERGED_GROUP_ID,
      name: '',
      models: [...rows.values()].map(pending => pending.model),
      merged: true,
      routeOf: modelId => byId.get(modelId)?.route,
      hasRoute: (modelId, provider) => byId.get(modelId)?.providers.has(provider) ?? false,
      entryOf: (modelId, provider) => {
        const pending = byId.get(modelId)
        if (pending === undefined) return undefined
        return provider === undefined ? pending.model : pending.providers.get(provider) ?? pending.model
      },
    })
  }
  for (const group of orderModelProviders(groups)) {
    if (!isEngineGroup(group.id) && group.id !== MAGPIE_ROUTING_PROVIDER) continue
    sections.push({
      id: group.id,
      name: group.name,
      models: group.models,
      merged: false,
      routeOf: () => group.id,
      hasRoute: (modelId, provider) => provider === group.id && group.models.some(model => model.id === modelId),
      entryOf: modelId => group.models.find(model => model.id === modelId),
    })
  }
  return sections
}

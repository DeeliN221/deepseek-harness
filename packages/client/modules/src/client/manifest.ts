/**
 * Client module system: the browser peer of Node's internal ESM loader, built
 * as a lazy CJS table. The vendored cordis Loader consumes this object
 * through its `internal` contract (the only call site is `EntryTree.import` →
 * `internal.import`), which keeps entry governance (fiber lifecycle, inject
 * waiting, update/refresh) entirely on the vendored side while this package
 * owns code arrival.
 *
 * Lazy CJS model: executing a plugin bundle only REGISTERS its
 * factory and deferred metadata producer. JavaScript module body side effects
 * run at materialization, not registration; metadata remains opaque to the loader. Materialization
 * (factory(require) → exports) happens on first import/require and is
 * memoized in {@link ClientModuleLoader.loadCache}; a factory that requires
 * another registered-but-unmaterialized module materializes it recursively,
 * so load order needs no external sequencing.
 *
 * Resolution branch order (import): memoized
 * record → exports; graph row → register its dependency factories and own
 * factory; registered factory → materialize; anything else → throw (loud —
 * the runtime mirror of the build-time bundle purity gate).
 * The synchronous `require` handed to factories walks the same order minus
 * the load branch. Loading is async, so a requested dynamic package must have
 * registered its factory before a consumer materializes.
 *
 * This file is the browser-safe contract face (zero node imports): the
 * `__DSH_BOOT__` wire types, the boot-manifest parser, and the boundaries around
 * {@link ClientModuleSystem}. The package root is the host-side service that
 * composes the wire.
 */

import type {} from '@deepseek-ai/cordis'
import type {
  DshClientDeferredManifest, DshClientManifest, ClientModuleMetaFactory,
  DshClientModuleManifest,
} from '@deepseek-ai/dsh-package-manifest'
import type { ScriptRealm } from '@deepseek-ai/dsh-client-script-realm/client'
export type { ClientBundleRequire } from '@deepseek-ai/dsh-package-manifest'
import type { ClientEntries } from './entries.ts'
import type { ClientModuleSystem } from './system.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The client module system the web shell builds at boot (provided by the `./client` wrapper plugin). */
    modules: ClientModuleLoader
  }
}

/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch. `inject` names package rows whose
 * factories must arrive before this row materializes, while Cordis separately
 * uses the same package edges to compose entries. `external` carries exact
 * non-inject module requests (see {@link WebBootGraph.entries}).
 *
 * `lazy` marks a deferred row: it belongs to no initial-load batch, so its
 * bytes are absent from the first-paint graph and the shell creates no Loader
 * entry for it until {@link ClientModuleLoader.activateDeferred} materializes
 * it. A lazy row is never implicit — the host roster names it.
 */
export interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /**
   * Revisioned single-resource combo reference used by HMR. It is relative to
   * the document, so the browser resolves it under whatever mount served the page.
   */
  url: string
  /** Opaque plugin-artifact revision used for HMR cache busting. */
  rev: string
  /** Package-name dependency edges used for factory arrival and plugin composition. */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
  /** Non-baseline module specifiers this row requests; omitted when it requests none. */
  external?: string[]
  /** Deferred row: no initial batch and no boot-time Loader entry (see {@link DeferredEntryInfo}). */
  lazy?: true
  /** Human-readable description of what materializes the row (`slot:settings.plugins`, `command:/plugins`, …). */
  trigger?: string
  /** Slot keys the deferred row's registration fills, when it owns slots (drives the loading skeleton). */
  slots?: string[]
}

/** Initial scheduling phase for one revisioned combo script. */
export type WebBootBatchPhase = 'bootstrap' | 'application'

/** One initial combo script; a scheduling phase may span several descriptors. */
export interface WebBootBatch {
  /** Parser-blocking bootstrap or preloaded application scheduling. */
  phase: WebBootBatchPhase
  /** Content-addressed combo script reference, document-relative like {@link WebBootEntry.url}. */
  url: string
  /** Revision derived from the ordered entry revisions. */
  rev: string
  /** Graph entry ids whose factories the script registers, in execution order. */
  entries: string[]
}

/** Host release identity; two releases are the same when both fields are equal. */
export interface WebBootRelease {
  /** Release version label. */
  version: string
  /** Source commit fixed in when the Host was built; absent when the build recorded none. */
  commit?: string
}

/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
export interface WebBootGraph {
  /** Consistency anchor over the current entry and batch descriptors. */
  rev: string
  /** Host release identity; absent from a Host that publishes none. */
  release?: WebBootRelease
  /**
   * Composed entries in module-graph order — a dynamic package row precedes
   * rows whose `external` requests that package. Cordis activation order is
   * unrelated and remains owned by fiber service waiting.
   */
  entries: WebBootEntry[]
  /** Initial combo descriptors; every entry belongs to exactly one descriptor. */
  batches: WebBootBatch[]
}

/** The npm-package view of one boot row: what the module table needs to fetch the bundle. */
export interface BootModuleRow {
  /** Entry name == package name (module-table key). */
  id: string
  /** Revisioned single-resource combo reference: the fallback when the row's batch fails and the reload target after HMR invalidation. */
  url: string
  /** Content-addressed combo reference used before the first HMR invalidation. */
  initialUrl: string
  /** Opaque plugin-artifact revision used after HMR invalidation. */
  rev: string
  /** Injected package rows whose factories arrive before this row materializes. */
  inject: string[]
  /** Module specifiers this row requests from the module table ([] when the wire omits them). */
  external: string[]
}

/** The cordis-plugin view of one boot row: what entry composition needs (optional wire fields normalized). */
export interface BootPluginRow {
  /** Entry name == package name. */
  id: string
  /** Package-name dependency edges ([] when the wire omits them). */
  inject: string[]
  /** Stage-one prefetch tier (false when the wire omits it). */
  immediately: boolean
  /** Deferred row: composed as a graph node but not created or awaited at boot. */
  lazy: boolean
  /** Description of the row's materialization trigger, when the Host published one. */
  trigger?: string
  /** Slot keys the row's registration fills ([] when it owns none). */
  slots: string[]
}

/** The parsed boot manifest: one wire, two consumer views. */
export interface BootManifest {
  /** Consistency anchor over the whole graph. */
  rev: string
  /** Host release identity carried by the graph; absent when the Host publishes none. */
  release?: WebBootRelease
  /** Rows as the module table consumes them. */
  modules: BootModuleRow[]
  /** Rows as entry composition consumes them. */
  plugins: BootPluginRow[]
}

/** One deferred row after boot: identity plus the trigger and slots the Host published. */
export interface DeferredEntryInfo {
  /** Entry name == package name. */
  readonly id: string
  /** Human-readable description of what materializes the row, when the Host published one. */
  readonly trigger?: string
  /** Slot keys the row's registration fills; the shell renders a skeleton for them until arrival. */
  readonly slots: readonly string[]
}

/** Materialization phase of one deferred row. */
export type DeferredEntryPhase = 'pending' | 'loading' | 'ready' | 'failed'

/** Observable state of one deferred row (`pending` before the first trigger). */
export interface DeferredEntryStatus {
  /** Entry name == package name. */
  readonly id: string
  /** Current phase; `loading` covers the retry as well. */
  readonly phase: DeferredEntryPhase
  /** Entry failure text (the same wording the boot audit uses) once `failed`. */
  readonly message?: string
}

/**
 * Ids that must be eager: every row that is not deferred, plus the transitive
 * closure of `inject` edges leaving them. A deferred row that an eager row
 * injects is the service provider the eager row waits for, so deferring it
 * would leave that eager entry pending forever.
 *
 * The closure is a fixpoint, which is what makes it independent of declaration
 * order: a promoted row's own `inject` edges are promoted in turn, and a row
 * declared after the row that requires it is promoted by the same pass.
 * @param rows - graph rows as declared (wire form or plugin form).
 * @returns the ids composition must keep eager.
 */
export function eagerClosureIds(
  rows: readonly { readonly id: string; readonly inject?: readonly string[]; readonly lazy?: boolean }[],
): ReadonlySet<string> {
  const byId = new Map<string, { readonly id: string; readonly inject?: readonly string[]; readonly lazy?: boolean }>()
  for (const row of rows) byId.set(stripClientSuffix(row.id), row)
  const eager = new Set<string>()
  const open: string[] = []
  for (const row of rows) {
    if (row.lazy === true) continue
    const id = stripClientSuffix(row.id)
    if (eager.has(id)) continue
    eager.add(id)
    open.push(id)
  }
  // Walk service edges from every eager row; a lazy provider met on the walk
  // becomes eager, and its own inject edges join the walk.
  while (open.length > 0) {
    const id = open.pop() as string
    for (const request of byId.get(id)?.inject ?? []) {
      const dependency = stripClientSuffix(request)
      if (!byId.has(dependency) || eager.has(dependency)) continue
      eager.add(dependency)
      open.push(dependency)
    }
  }
  return eager
}

/**
 * Validate an optional string-array field read from a `dsh.client` declaration
 * or from the boot wire.
 * @param subject - diagnostic prefix naming the package or the wire row.
 * @param field - field name as it appears in the diagnostic.
 * @param value - the raw field value.
 * @returns the validated array, or undefined when the field is absent.
 * @throws {Error} when the value is present but is not an array of strings.
 */
export function optionalStringArray(subject: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`client-modules: ${subject} ${field} must be a string array`)
  }
  return value as string[]
}

/**
 * Narrow an unknown parsed JSON value to the `dsh.client` declaration. Shared
 * by the node half's Loader scan and the roster generator, so both read a
 * package's browser declaration through one validator.
 * @param pkgName - package name used as the diagnostic prefix.
 * @param value - the raw `dsh.client` field of the package manifest.
 * @returns the validated declaration, or undefined when the field is absent.
 * @throws {Error} when the field is present but any member is malformed.
 */
export function parseDshClient(pkgName: string, value: unknown): DshClientManifest | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
  const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  const deferred = parseDeferredManifest(pkgName, decl.deferred)
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    ...(external !== undefined ? { external } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
    ...(deferred !== undefined ? { deferred } : {}),
  }
}

/**
 * Narrow an unknown `dsh.client.deferred` value: `true`, or an object carrying
 * the trigger description and slot keys the shell materializes the row from.
 * @param pkgName - package name used as the diagnostic prefix.
 * @param value - the raw declaration member.
 * @returns the normalized metadata, or undefined when the member is absent.
 * @throws {Error} when the member is present but malformed.
 */
export function parseDeferredManifest(pkgName: string, value: unknown): true | DshClientDeferredManifest | undefined {
  if (value === undefined) return undefined
  if (value === true) return true
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} dsh.client.deferred must be true or an object`)
  }
  const decl = value as Record<string, unknown>
  if (decl.trigger !== undefined && typeof decl.trigger !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.deferred.trigger must be a string`)
  }
  const slots = optionalStringArray(pkgName, 'dsh.client.deferred.slots', decl.slots)
  return {
    ...(decl.trigger === undefined ? {} : { trigger: decl.trigger }),
    ...(slots === undefined ? {} : { slots }),
  }
}

/**
 * The bare package-root specifier `specifier` names, or undefined for a subpath, a path, or any scheme-qualified
 * specifier (`cordis:` builtins, `node:` modules, URLs).
 * @param specifier - Loader row name.
 * @returns the package name, or undefined.
 */
export function exactPackageSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined
}

/**
 * Normalize a module specifier onto the graph row that owns it: a plugin bundle
 * IS its package's client half, so `<id>/client` (the exports subpath external
 * bundles emit) and the bare package name resolve to the same exports. Both the
 * require path and graph composition normalize here, which is what lets each
 * importing package request the subpath its own code imports.
 * @param spec - module specifier as a bundle requires it or a declaration spells it.
 * @returns the specifier with a trailing `/client` removed.
 */
export function stripClientSuffix(spec: string): string {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

/**
 * Parse `window.__DSH_BOOT__` into the two consumer views. Wire boundary:
 * a missing or malformed graph throws (the shell shows the loud failure —
 * a page without a valid manifest cannot boot anything).
 * @param wire - the raw `window.__DSH_BOOT__` value.
 * @returns the manifest with optional plugin-view fields normalized.
 */
export function parseBootManifest(wire: unknown): BootManifest {
  if (typeof wire !== 'object' || wire === null) {
    throw new Error('client-modules: window.__DSH_BOOT__ is missing or not an object')
  }
  const graph = wire as Record<string, unknown>
  if (typeof graph.rev !== 'string') {
    throw new Error('client-modules: boot manifest rev must be a string')
  }
  const release = decodeRelease(graph.release)
  if (release === null) {
    throw new Error('client-modules: boot manifest release must carry a string version and an optional string commit')
  }
  if (!Array.isArray(graph.entries)) {
    throw new Error('client-modules: boot manifest entries must be an array')
  }
  if (!Array.isArray(graph.batches)) {
    throw new Error('client-modules: boot manifest batches must be an array')
  }
  const moduleFields: Omit<BootModuleRow, 'initialUrl'>[] = []
  const plugins: BootPluginRow[] = []
  const seenEntryIds = new Set<string>()
  for (const value of graph.entries as unknown[]) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('client-modules: boot manifest entry is not an object')
    }
    const row = value as Record<string, unknown>
    const where = typeof row.id === 'string' ? `"${row.id}"` : JSON.stringify(row)
    if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
      throw new Error(`client-modules: boot manifest entry ${where} must carry string id/url/rev`)
    }
    if (seenEntryIds.has(row.id)) throw new Error(`client-modules: duplicate graph entry "${row.id}"`)
    seenEntryIds.add(row.id)
    const subject = `boot manifest entry ${where}`
    const inject = optionalStringArray(subject, 'inject', row.inject)
    const external = optionalStringArray(subject, 'external', row.external)
    if (row.immediately !== undefined && typeof row.immediately !== 'boolean') {
      throw new Error(`client-modules: boot manifest entry ${where} immediately must be a boolean`)
    }
    if (row.lazy !== undefined && row.lazy !== true) {
      throw new Error(`client-modules: boot manifest entry ${where} lazy must be true when present`)
    }
    if (row.trigger !== undefined && typeof row.trigger !== 'string') {
      throw new Error(`client-modules: boot manifest entry ${where} trigger must be a string`)
    }
    const slots = optionalStringArray(subject, 'slots', row.slots)
    moduleFields.push({
      id: row.id,
      url: row.url,
      rev: row.rev,
      inject: inject === undefined ? [] : [...inject],
      external: external === undefined ? [] : [...external],
    })
    plugins.push({
      id: row.id,
      inject: inject === undefined ? [] : [...inject],
      immediately: row.immediately === true,
      lazy: row.lazy === true,
      ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
      slots: slots === undefined ? [] : [...slots],
    })
  }

  // Dependency safety at the wire boundary as well: the Host composes the
  // eager closure, but a hand-written or older graph must not be able to defer
  // the provider an eager row injects. Rows the wire marked deferred keep their
  // single-resource fallback after promotion, because a graph composed before
  // the promotion put them in no batch.
  const declaredLazy = new Set(plugins.filter(row => row.lazy).map(row => row.id))
  const eager = eagerClosureIds(plugins)
  for (const row of plugins) {
    if (!eager.has(row.id)) continue
    row.lazy = false
  }

  const entryIds = new Set(moduleFields.map(row => row.id))
  const initialUrls = new Map<string, string>()
  const batchUrls = new Set<string>()
  const lazyIds = new Set(plugins.filter(row => row.lazy).map(row => row.id))
  for (const value of graph.batches as unknown[]) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('client-modules: boot manifest batch is not an object')
    }
    const batch = value as Record<string, unknown>
    const phase = batch.phase
    if (phase !== 'bootstrap' && phase !== 'application') {
      throw new Error(`client-modules: boot manifest batch phase must be "bootstrap" or "application", received ${JSON.stringify(phase)}`)
    }
    if (typeof batch.url !== 'string' || typeof batch.rev !== 'string') {
      throw new Error(`client-modules: boot manifest ${phase} batch must carry string url/rev`)
    }
    if (batchUrls.has(batch.url)) {
      throw new Error(`client-modules: boot manifest carries duplicate batch URL ${JSON.stringify(batch.url)}`)
    }
    batchUrls.add(batch.url)
    const entries = optionalStringArray(`boot manifest ${phase} batch`, 'entries', batch.entries)
    if (entries === undefined || entries.length === 0) {
      throw new Error(`client-modules: boot manifest ${phase} batch entries must be a non-empty string array`)
    }
    for (const id of entries) {
      if (!entryIds.has(id)) {
        throw new Error(`client-modules: boot manifest ${phase} batch names unknown entry "${id}"`)
      }
      if (lazyIds.has(id)) {
        throw new Error(`client-modules: deferred entry "${id}" must not belong to the ${phase} batch — its bytes would load before first paint`)
      }
      if (initialUrls.has(id)) {
        throw new Error(`client-modules: boot manifest entry "${id}" belongs to more than one batch`)
      }
      initialUrls.set(id, batch.url)
    }
  }
  const modules = moduleFields.map((row): BootModuleRow => {
    const initialUrl = initialUrls.get(row.id)
    if (initialUrl !== undefined) return { ...row, initialUrl }
    if (lazyIds.has(row.id) || declaredLazy.has(row.id)) return { ...row, initialUrl: row.url }
    throw new Error(`client-modules: boot manifest entry "${row.id}" belongs to no initial-load batch`)
  })
  return { rev: graph.rev, ...(release === undefined ? {} : { release }), modules, plugins }
}

/**
 * Decode a wire release identity, dropping members outside {@link WebBootRelease}.
 * @param value - the graph's `release` member.
 * @returns the release, undefined when absent, or null when present but malformed.
 */
function decodeRelease(value: unknown): WebBootRelease | undefined | null {
  if (value === undefined) return undefined
  const release = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  const commit = release?.commit
  if (release === undefined || typeof release.version !== 'string' || (commit !== undefined && typeof commit !== 'string')) return null
  return { version: release.version, ...(commit === undefined ? {} : { commit }) }
}

/**
 * Read a Host graph's release without validating the rest of the graph, so releases stay comparable
 * when another release changes the graph format.
 * @param wire - JSON-decoded graph received from the Host.
 * @returns the release, or undefined when the graph carries none or it cannot be read.
 */
export function readRelease(wire: unknown): WebBootRelease | undefined {
  if (typeof wire !== 'object' || wire === null) return undefined
  return decodeRelease((wire as Record<string, unknown>).release) ?? undefined
}

/** Registration face of one shared browser artifact manifest. */
export type ClientBundleRegistration = DshClientModuleManifest

/** Inputs passed by the web entry when it creates the client module system. */
export interface ClientModuleCreateOptions {
  /** Raw Host-injected boot graph; the modules bundle owns validation and projection. */
  boot: unknown
  /** Initially delivered manifests; registration does not evaluate their JavaScript or metadata. */
  staticModules: readonly DshClientModuleManifest[]
  /** Execution hook for the module system’s Main Realm; defaults to the page script transport. */
  loadBundle?: (url: string) => Promise<void>
  /** Package-asset reference hook behind {@link ClientBundleRequire.asset}. Defaults to returning the reference. */
  resolveAsset?: (reference: string) => string
}

/** The modules bundle after its factory has been materialized by the HTML bootstrap facade. */
export interface ClientBootstrapModule {
  /** Graph/module id carried by the modules bundle registration. */
  id: string
  /** Materialized exports reused when Cordis later activates the modules entry. */
  exports: Record<string, unknown>
}

/** Stable page-global facade: queues early bundle registrations, then registers them live. */
export interface ClientModuleLoaderTarget {
  /** Queue before {@link create}; live registration after it returns. */
  mode: 'queue' | 'live'
  /** Registrations submitted by parser-preloaded scripts before the module system exists. */
  pendingQueue: ClientBundleRegistration[]
  /** Queue or immediately register one bundle factory according to {@link mode}. */
  load(registration: ClientBundleRegistration): void
  /** Create the module system exactly once from the parser-preloaded modules bundle. */
  create(options: ClientModuleCreateOptions): ClientModuleSystem
}

/** Window API of the web boot protocol: the host-injected graph and registration facade. */
export interface DshWindow {
  /** Host-composed entry graph, injected before the shell bundle runs; wire-boundary raw until {@link parseBootManifest}. */
  __DSH_BOOT__?: unknown
  /** HTML-installed facade: a pending registration queue, then the live module-system target. */
  __ModuleLoader__?: ClientModuleLoaderTarget
}

/** Per-module bookkeeping in {@link ClientModuleLoader.loadCache} (flat module-graph boundary). */
export interface ClientModuleRecord {
  /** Module id (entry name / package name). */
  id: string
  /** Package identity shared by its entry and package-local chunks. */
  readonly ownerId: string
  /** Materialized exports (`module.exports` from a factory or bootstrap registration). */
  exports: unknown
  /** Deferred metadata producer; JavaScript materialization does not evaluate it. */
  meta?: ClientModuleMetaFactory
  /** Observed `require()` edges (module-graph boundary; only table words can appear). */
  edges: Set<string>
}

/**
 * The internal-contract subset the vendored Loader and the client HMR plugin
 * consume. Mounted on `ctx.loader.internal` by the shell boot and provided
 * as `ctx.modules`.
 */
export interface ClientModuleLoader {
  /**
   * Observe changes to {@link activeRecords} and to their cross-package dependency edges.
   * @param listener - Called after a record materializes, records are released, or a record requests another package.
   * @returns The subscription disposer.
   */
  subscribeModules(listener: () => void): () => void
  /**
   * Records whose code can still be running: every {@link loadCache} record, plus the previous records of a
   * package under live replacement until its old runtime has been torn down.
   * @returns Previous records of replaced packages, then materialized records in registry order.
   */
  activeRecords(): Iterable<ClientModuleRecord>
  /**
   * Resolve an asset reference through the startup carrier.
   * @param reference - Compiled package-asset reference.
   * @returns The carrier's resolved URL.
   */
  resolveAsset(this: void, reference: string): string

  /** Discriminant against Node's internal loader shapes ('v1'/'v2'). */
  version: 'client'
  /** Latest parsed Host graph, updated by live entry reconciliation. */
  manifest: BootManifest
  /** Page-owned entry reconciliation, shared by boot, graph updates and HMR. */
  entries: ClientEntries
  /** Materialized-module registry: entry or package-local chunk id → record. */
  loadCache: Map<string, ClientModuleRecord>
  /** Initial execution environment, fixed when the module system is constructed. */
  readonly mainRealm: Pick<ScriptRealm, 'id' | 'execute' | 'dispose'>
  /** Stop accepting scripts and await pending carrier operations. */
  dispose(): Promise<void>
  /**
   * Internal contract consumed by the vendored Loader's `tree.import`. Resolves
   * `specifier` through the branch order documented on the module, fetching
   * and executing a bundle when needed.
   * @param specifier - module specifier (entry name or table word).
   * @param parentURL - importer URL (unused — the client module graph is flat).
   * @param attrs - Import attributes (unused; interface parity with Node's loader contract).
   * @returns the module's exports.
   */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
  /**
   * Stage-one arrival: load the entry's declared dynamic requests, then its
   * own script, to register their factories (no materialization — module side
   * effects wait for import).
   * No-op for materialized bootstrap ids. A registered graph row still
   * registers any unresolved declared requests before skipping its own script;
   * concurrent arrivals share one in-flight task. To force a fresh load (HMR),
   * {@link invalidate} first.
   * @param id - graph entry name.
   */
  prefetch(id: string): Promise<void>
  /**
   * The last failure of {@link import} or {@link prefetch} for one graph row:
   * transport, registration, dependency cascade, or factory execution. Cleared
   * by a later success and by {@link invalidate}. The boot audit reads it to
   * report why a Loader entry has no fiber.
   * @param id - graph entry name.
   * @returns the recorded failure, or `undefined` when the row never failed or succeeded since.
   */
  importError(id: string): Error | undefined
  /**
   * Rows composed as deferred: their bundles are in no initial batch and no
   * Loader entry exists for them until {@link activateDeferred} runs. Pending
   * rows only (a materialized row leaves the list); the order is composition
   * order, so it is stable across reads.
   * @returns the deferred rows that are still pending.
   */
  deferredEntries(): readonly DeferredEntryInfo[]
  /**
   * Materialize one deferred row on first need: fetch its bundle, create its
   * Loader entry and await activation. Concurrent calls for the same row share
   * one attempt; a failed attempt is retried once before it is reported.
   * Resolves immediately for a row that is not deferred (already eager or
   * already materialized). Rejects with the entry failure text on the second
   * failure; callers own the presentation (the deferred slot face and the boot
   * page both render it).
   * @param id - graph entry name.
   */
  activateDeferred(id: string): Promise<void>
  /**
   * Current phase of one deferred row.
   * @param id - graph entry name.
   * @returns the phase, or `undefined` when the row is not a deferred row.
   */
  deferredStatus(id: string): DeferredEntryStatus | undefined
  /**
   * Subscribe to deferred-row phase changes (a row became loading, ready, or
   * failed). The slot deferral face installs the skeleton and error state from
   * this channel.
   * @param listener - called after every change; returns unsubscribe.
   * @returns the unsubscribe function.
   */
  onDeferredChange(listener: () => void): () => void
  /**
   * Full reset of one non-bootstrap package: drop its entry and chunk factories
   * and materialized records so the next prefetch/import loads its one-resource
   * combo script rather than the initial multi-resource request. The bootstrap
   * module remains materialized.
   * @param id - entry name to invalidate.
   * @param rev - New content revision from the HMR frame; omitted to reuse
   * the graph revision or for page-local modules that register directly.
   */
  invalidate(id: string, rev?: string): void
}

/** Internal construction inputs assembled by the modules bundle's bootstrap export. */
export interface ClientModuleSystemOptions {
  /** Boot graph validated by {@link parseBootManifest}, owned by the resulting module system. */
  manifest: BootManifest
  /** Initially delivered manifests; registration does not evaluate their JavaScript or metadata. */
  staticModules: readonly DshClientModuleManifest[]
  /** Stable HTML-installed registration facade to switch from queue to live mode. */
  registrationTarget: ClientModuleLoaderTarget
  /** Already-materialized modules bundle consumed while creating the system. */
  bootstrapModule: ClientBootstrapModule
  /** Execution hook for the module system’s Main Realm; defaults to the page script transport. */
  loadBundle?: (url: string) => Promise<void>
  /** Package-asset reference hook behind {@link ClientBundleRequire.asset}. Defaults to returning the reference. */
  resolveAsset?: (reference: string) => string
}

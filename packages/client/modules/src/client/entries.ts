/** Page-owned Loader entries; transport-independent reconciliation, retries and code replacement. */
import type { FiberState } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { parseBootManifest, readRelease, stripClientSuffix } from './manifest.ts'
import type {
  BootManifest, ClientModuleLoader, DeferredEntryInfo, DeferredEntryPhase, DeferredEntryStatus,
} from './manifest.ts'
import { ReleaseChangeGate, type ClientReleaseChange } from './release-change.ts'
import { notifySubscribers } from './notify.ts'
import { tearDownEntryFiber } from './entry-lifecycle.ts'

/** Page-local failures do not change the Host's bundle enablement. */
export interface ClientEntryState {
  /** True while a snapshot, retry or code replacement is being applied. */
  readonly syncing: boolean
  /** Package ids and errors from the latest reconciliation. */
  readonly failures: readonly { readonly id: string; readonly message: string }[]
}

/** Module-table capabilities used within serialized entry operations. */
interface ModuleIndex {
  update(manifest: BootManifest, managed: Iterable<string>): void
  /** Reset a package's code while its previous records stay active for the runtime that is still running. */
  invalidateForReplacement(id: string, rev: string): void
  /** Release the previous records once the replaced runtime has been torn down. */
  releaseReplaced(id: string): void
  prune(roots: Iterable<string>): void
}

/** Numeric values mirror Cordis's const enum, which bundle loaders cannot import as a runtime object. */
const ACTIVE = 2 as FiberState.ACTIVE
const FAILED = 3 as FiberState.FAILED

/** Revisions and requests identify desired code; URLs only select its immutable delivery resource. */
function entryTargets(manifest: BootManifest): string {
  return JSON.stringify(manifest.modules.map(row => [row.id, row.rev, row.inject, row.external]))
}

/** Revisions and deferral of composed rows identify desired code; URLs only select its immutable delivery resource. */
function pluginTargets(manifest: BootManifest): string {
  return JSON.stringify(manifest.plugins.map(row => [row.id, row.lazy, row.trigger, row.slots]))
}

/** Manages only entries created from the Host manifest; other Loader contributors retain ownership. */
export class ClientEntries {
  /** Stable observable consumed by page diagnostics through the renderer's injected hook. */
  readonly state: ObservableSnapshot<ClientEntryState> = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }
  // The modules bootstrap factory cannot request platform libraries before the shell supplies its seed.
  private snapshot: ClientEntryState = { syncing: false, failures: [] }
  private readonly listeners = new Set<() => void>()
  /** Admits only Host graphs of the page's boot release. */
  private readonly release: ReleaseChangeGate
  private readonly managed = new Map<string, Entry>()
  private readonly revisions = new Map<string, string>()
  /** Deferred rows composed but not materialized yet (removed once their entry exists). */
  private readonly deferred = new Map<string, DeferredEntryInfo>()
  /** Phase of every deferred row ever materialized in this page; `ready` rows stay addressable. */
  private readonly deferredStatuses = new Map<string, DeferredEntryStatus>()
  /** One in-flight materialization per row, so concurrent triggers share an attempt. */
  private readonly activations = new Map<string, Promise<void>>()
  private readonly deferredListeners = new Set<() => void>()
  private loader: Loader | undefined
  private queue: Promise<void> = Promise.resolve()
  private desired: BootManifest
  private generation = 0
  private stopped = false

  /**
   * Construct the page controller before Cordis boot.
   * @param modules - Module arrival and materialization owner.
   * @param index - Private descriptor replacement and unused-module cleanup.
   */
  constructor(private readonly modules: ClientModuleLoader, private readonly index: ModuleIndex) {
    this.desired = modules.manifest
    this.release = new ReleaseChangeGate(modules.manifest.release)
  }

  /** Host release change to announce; undefined while the Host serves the page's boot release or a dismissed one. */
  get releaseChange(): ObservableSnapshot<ClientReleaseChange | undefined> {
    return this.release.change
  }

  /** Stop announcing the connected Host's release; updates stay paused until the Host returns to the boot release or the page reloads. */
  dismissRelease(): void {
    this.release.dismiss()
  }

  /**
   * Create the initial roster and retain its entry identities for subsequent reconciliation.
   * As the Host Loader group does, a row whose creation rejects (for example a module that exports no
   * plugin) is logged and stays an inactive entry, so one row cannot abort startup before the boot audit.
   * Deferred rows are recorded instead of created: their bundles are in no
   * initial batch, so creating an entry for them would fetch the bytes the
   * deferral exists to avoid.
   * @param loader - Page Loader, already configured with the module system.
   * @param manifest - Initial roster audited by the boot caller.
   * @returns after initial entries and their activation settle; boot owns its activation audit.
   */
  start(loader: Loader, manifest: BootManifest): Promise<void> {
    if (this.loader !== undefined) throw new Error('client-modules: entries already started')
    this.loader = loader
    this.desired = manifest
    loader.ctx.effect(() => () => {
      this.stopped = true
      this.generation++
      return this.queue
    }, 'client-modules: entry reconciliation')
    return this.enqueue(async () => {
      this.trackDeferred(manifest)
      await Promise.all(manifest.plugins
        .filter(row => !this.isDeferred(row.id))
        .map(async ({ id }) => {
          await this.create(loader, id).catch((error: unknown) => { loader.ctx.logger.error(error) })
        }))
      await loader.await()
      for (const row of this.modules.manifest.modules) this.revisions.set(row.id, row.rev)
    })
  }

  /** Deferred rows that are still pending, in composition order. */
  deferredEntries(): readonly DeferredEntryInfo[] {
    return [...this.deferred.values()]
  }

  /**
   * Phase of one deferred row.
   * @param id - graph entry name.
   * @returns the phase, or `undefined` for a row that is not deferred.
   */
  deferredStatus(id: string): DeferredEntryStatus | undefined {
    return this.deferredStatuses.get(stripClientSuffix(id))
  }

  /**
   * Subscribe to deferred phase changes.
   * @param listener - called after every deferred change.
   * @returns unsubscribe.
   */
  onDeferredChange(listener: () => void): () => void {
    this.deferredListeners.add(listener)
    return () => { this.deferredListeners.delete(listener) }
  }

  /**
   * Materialize one deferred row on first need. Concurrent triggers share the
   * single in-flight attempt; a failed attempt is discarded and retried once.
   * @param id - graph entry name.
   * @returns after the row is active, immediately for a non-deferred row.
   * @throws {Error} with the entry failure text once both attempts fail.
   */
  activate(id: string): Promise<void> {
    const normalized = stripClientSuffix(id)
    if (!this.deferred.has(normalized)) return Promise.resolve()
    const running = this.activations.get(normalized)
    if (running !== undefined) return running
    const run = this.enqueue(async () => { await this.materialize(normalized) }, `deferred:${normalized}`)
      .then(() => {
        const status = this.deferredStatuses.get(normalized)
        if (status?.phase === 'failed') throw new Error(status.message)
      })
      .finally(() => { this.activations.delete(normalized) })
    this.activations.set(normalized, run)
    return run
  }


  /**
   * Validate and apply the latest full Host graph. Changed targets cancel obsolete mounts; identical targets share pending loads.
   * The release is compared before the rest of the graph is validated: a graph of another release, including one whose
   * format this page cannot read, is not applied and {@link releaseChange} announces it.
   * @param graph - JSON-decoded graph received from the Host.
   * @returns after the queued reconciliation, or at once for another release; per-package failures remain available in {@link state}.
   */
  sync(graph: unknown): Promise<void> {
    if (!this.release.observe(readRelease(graph))) return Promise.resolve()
    const manifest = parseBootManifest(graph)
    if (entryTargets(manifest) !== entryTargets(this.desired) || pluginTargets(manifest) !== pluginTargets(this.desired)) {
      this.generation++
    }
    this.desired = manifest
    const generation = this.generation
    return this.enqueue(() => this.reconcile(generation))
  }

  /**
   * Retry failed entries against the latest graph, including an unchanged revision.
   * @returns after retry settlement, with remaining errors in {@link state}.
   */
  retry(): Promise<void> {
    const generation = ++this.generation
    return this.enqueue(() => this.reconcile(generation))
  }

  /**
   * Replace one entry's code in the same queue as graph updates; duplicate revisions are ignored.
   * Entries missing after a failed import are reconciled; bootstrap replacement fails before teardown.
   * Ignored while the connected Host serves another release than the page's boot release.
   * @param id - Package id from a rebuilt frame.
   * @param rev - Opaque revision selecting the rebuilt artifact.
   * @returns after queued work; replacement errors reject, while per-package reconciliation errors remain in {@link state}.
   */
  reload(id: string, rev: string): Promise<void> {
    if (!this.release.matches) return Promise.resolve()
    this.desired = {
      ...this.desired,
      modules: this.desired.modules.map(row => row.id === id ? { ...row, rev } : row),
    }
    // A deferred row has no entry to replace until something triggers it; the
    // new revision is recorded above and the next activation loads it.
    if (this.deferred.has(stripClientSuffix(id))) {
      this.modules.invalidate(id, rev)
      return Promise.resolve()
    }
    return this.enqueue(async () => {
      const desired = this.desired.modules.find(row => row.id === id)
      if (this.stopped || desired === undefined) return
      const entry = this.managed.get(id)
      if (entry === undefined) {
        this.modules.invalidate(id, desired.rev)
        await this.reconcile(this.generation)
        return
      }
      if (this.revisions.get(id) === rev) return
      this.publish({ syncing: true, failures: this.snapshot.failures.filter(failure => failure.id !== id) })
      await this.replace(entry, id, rev, this.generation)
      this.publish({ syncing: false, failures: this.snapshot.failures })
    }, id)
  }

  private publish(snapshot: ClientEntryState): void {
    this.snapshot = snapshot
    notifySubscribers(this.listeners, 'synchronization')
  }

  private enqueue(task: () => Promise<void>, subject = 'graph'): Promise<void> {
    const run = this.queue.then(task)
    // Each operation reports its own failure; later operations must still run.
    this.queue = run.then(() => undefined, (error: unknown) => {
      this.publish({ syncing: false, failures: [
        ...this.snapshot.failures.filter(failure => failure.id !== subject),
        { id: subject, message: String(error) },
      ] })
    })
    return run
  }

  private current(generation: number): boolean {
    return !this.stopped && generation === this.generation
  }

  /** Keep ownership even when Loader rejects a module's plugin exports after inserting its entry. */
  private async create(loader: Loader, id: string): Promise<void> {
    const options = { name: id }
    const entryId = loader.ensureId(options)
    try {
      await loader.create(options)
    } finally {
      this.managed.set(id, loader.resolve(entryId))
    }
  }

  /**
   * Refresh the deferred roster from a manifest: rows that are no longer
   * deferred drop their hint (an activated row keeps its `ready` status).
   * @param manifest - composition the page is converging on.
   */
  private trackDeferred(manifest: BootManifest): void {
    const next = new Map<string, DeferredEntryInfo>()
    for (const row of manifest.plugins) {
      if (!row.lazy || this.managed.has(row.id)) continue
      next.set(row.id, {
        id: row.id,
        ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
        slots: [...row.slots],
      })
      if (!this.deferredStatuses.has(row.id)) {
        this.deferredStatuses.set(row.id, { id: row.id, phase: 'pending' })
      }
    }
    for (const id of this.deferred.keys()) {
      if (next.has(id)) continue
      this.deferred.delete(id)
    }
    for (const [id, info] of next) this.deferred.set(id, info)
  }

  /** Whether one row is composed as deferred and has not been materialized. */
  private isDeferred(id: string): boolean {
    return this.deferred.has(stripClientSuffix(id))
  }

  private setDeferredPhase(id: string, phase: DeferredEntryPhase, message?: string): void {
    this.deferredStatuses.set(id, { id, phase, ...(message === undefined ? {} : { message }) })
    notifySubscribers(this.deferredListeners, 'deferred entry change')
  }

  /**
   * Run one activation attempt, then a single retry, and publish the phase.
   * Never rejects: the phase is the outcome, so one unavailable plugin cannot
   * take down the trigger that asked for it.
   * @param id - deferred row to materialize.
   */
  private async materialize(id: string): Promise<void> {
    this.setDeferredPhase(id, 'loading')
    let failure: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.materializeOnce(id)
        this.deferred.delete(id)
        this.setDeferredPhase(id, 'ready')
        return
      } catch (error) {
        failure = error
        await this.discardFailedEntry(id)
      }
    }
    this.setDeferredPhase(id, 'failed', this.failureText(id, failure))
  }

  /** One load-and-activate attempt against the current graph. */
  private async materializeOnce(id: string): Promise<void> {
    const loader = this.loader
    if (loader === undefined) throw new Error('client-modules: entries have not started')
    await this.modules.prefetch(id)
    if (this.stopped) return
    await this.modules.import(id, '', {})
    if (this.stopped) return
    await this.create(loader, id)
    await loader.await()
    const entry = this.managed.get(id)
    if (entry === undefined || entry.fiber === undefined) {
      throw new Error(`client-modules: ${id} import failed (see console)`)
    }
    if (entry.fiber.state !== ACTIVE) await entry.fiber.await()
    if (entry.fiber.state !== ACTIVE) {
      throw new Error(`client-modules: ${id} is waiting for activation`)
    }
  }

  /** Drop the entry of a failed attempt so the retry starts from a clean fiber. */
  private async discardFailedEntry(id: string): Promise<void> {
    const entry = this.managed.get(id)
    if (entry === undefined) return
    const fiber = entry.fiber
    this.loader?.remove(entry.id)
    this.managed.delete(id)
    this.revisions.delete(id)
    while (fiber?.inertia !== undefined) await fiber.inertia
    this.index.prune([...this.loader?.entries() ?? []].map(row => row.options.name))
  }

  /**
   * The boot audit's wording for one failed row, so the same failure reads the
   * same way whether it happened before first paint or on a deferred trigger.
   */
  private failureText(id: string, error: unknown): string {
    const importError = this.modules.importError(id)
    const reason = importError?.message ?? (error instanceof Error ? error.message : String(error))
    return `${id}: import failed: ${reason}`
  }

  private async replace(entry: Entry, id: string, rev: string, generation: number): Promise<void> {
    this.index.invalidateForReplacement(id, rev)
    await this.modules.prefetch(id)
    if (!this.current(generation)) return
    await tearDownEntryFiber(entry)
    this.index.releaseReplaced(id)
    if (!this.current(generation)) return
    await this.modules.import(id, '', {})
    if (!this.current(generation)) return
    await entry.refresh()
    await entry.fiber?.await()
    if (entry.fiber === undefined) throw new Error(`client-modules: ${id} import failed (see console)`)
    this.revisions.set(id, rev)
  }

  private async reconcile(generation: number): Promise<void> {
    if (!this.current(generation)) return
    const loader = this.loader
    if (loader === undefined) throw new Error('client-modules: entries have not started')
    const manifest = this.desired
    this.publish({ syncing: true, failures: [] })
    this.trackDeferred(manifest)
    const failures: { id: string; message: string }[] = []
    this.index.update(manifest, this.managed.keys())
    const wanted = new Set(manifest.plugins.map(row => row.id))
    for (const [id, entry] of this.managed) {
      if (wanted.has(id)) continue
      const fiber = entry.fiber
      loader.remove(entry.id)
      this.managed.delete(id)
      this.revisions.delete(id)
      this.deferred.delete(id)
      // Removed fibers no longer appear in Loader.getTasks().
      while (fiber?.inertia !== undefined) await fiber.inertia
    }
    for (const row of manifest.modules) {
      if (!this.current(generation)) break
      // A deferred row materializes only through `activate`; reconciliation
      // must not turn a graph update into a first-paint load.
      if (this.isDeferred(row.id)) continue
      try {
        const entry = this.managed.get(row.id)
        if (entry === undefined) {
          await this.modules.prefetch(row.id)
          if (!this.current(generation)) break
          await this.modules.import(row.id, '', {})
          if (!this.current(generation)) break
          await this.create(loader, row.id)
          this.revisions.set(row.id, row.rev)
        } else if (this.revisions.get(row.id) !== row.rev) {
          await this.replace(entry, row.id, row.rev, generation)
        } else if (entry.fiber === undefined) {
          await this.replace(entry, row.id, row.rev, generation)
        } else if (entry.fiber.state === FAILED) {
          // A retry with unchanged config is not a configuration change to persist.
          await entry.fiber.update(entry.options.config, true)
        }
      } catch (error) {
        failures.push({ id: row.id, message: String(error) })
      }
    }
    await loader.await()
    for (const [id, entry] of this.managed) {
      if (failures.some(failure => failure.id === id)) continue
      if (entry.fiber?.state === ACTIVE) continue
      try {
        if (entry.fiber === undefined) throw new Error(`client-modules: ${id} import failed (see console)`)
        await entry.fiber.await()
        failures.push({ id, message: `client-modules: ${id} is waiting for activation` })
      } catch (error) {
        failures.push({ id, message: String(error) })
      }
    }
    this.index.prune([...loader.entries()].map(entry => entry.options.name))
    if (this.current(generation)) this.publish({ syncing: false, failures })
  }
}

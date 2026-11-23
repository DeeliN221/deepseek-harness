// @vitest-environment jsdom
/** Client-side deferral: boot creates eager entries only, and first need materializes one row exactly once. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as provideModules, createClientModuleSystem } from '../src/client/index.ts'
import type {
  ClientBundleRegistration, ClientModuleLoader, ClientModuleLoaderTarget, WebBootEntry, WebBootGraph,
} from '../src/client/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.fiber.dispose()
    await ctx.fiber.await()
  }
  document.head.querySelectorAll('style').forEach((el) => { el.remove() })
  vi.restoreAllMocks()
})

/** One graph row; a deferred row carries no batch (it loads from its own reference). */
const row = (id: string, extra: Partial<WebBootEntry> = {}): WebBootEntry => ({
  id,
  rev: 'r1',
  url: `plugins/??${id}/client.js&rev=r1`,
  ...extra,
})

/** Graph with one application batch holding every eager row. */
const graph = (...entries: WebBootEntry[]): WebBootGraph => {
  const eager = entries.filter(entry => !entry.lazy).map(entry => entry.id)
  return {
    rev: JSON.stringify(entries),
    entries,
    batches: eager.length === 0 ? [] : [{ phase: 'application', url: '/application', rev: 'batch', entries: eager }],
  }
}

interface Bench {
  moduleSystem: ClientModuleLoader
  fetched: string[]
  loader: Loader
}

/** Boot the page Loader over the supplied graph; `factories` are registered when their URL arrives. */
async function bench(boot: WebBootGraph, factories: Record<string, ClientBundleRegistration['factory']>): Promise<Bench> {
  const ctx = new Context()
  contexts.push(ctx)
  const fetched: string[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue: [],
    load: () => {},
    create: options => createClientModuleSystem(target, { id: 'bootstrap', exports: { inject: ['loader'], apply: provideModules } }, options),
  }
  const moduleSystem = target.create({
    boot,
    staticModules: [],
    loadBundle: async (url) => {
      fetched.push(url)
      const ids = url === '/application'
        ? boot.entries.filter(entry => !entry.lazy).map(entry => entry.id).filter(id => id !== 'bootstrap')
        : [/plugins\/\?\?([^/]+)\/client\.js/.exec(url)?.[1] ?? '']
      for (const id of ids) {
        const factory = factories[id]
        if (factory !== undefined) target.load({ id, factory })
      }
    },
  })
  await ctx.plugin(Loader)
  ctx.loader.internal = moduleSystem as never
  await moduleSystem.entries.start(ctx.loader, moduleSystem.manifest)
  return { moduleSystem, fetched, loader: ctx.loader }
}

/** A bundle factory for a trivially activating plugin. */
const plugin = (): ClientBundleRegistration['factory'] => () => ({ apply: () => {} })

describe('deferred client entries', () => {
  it('creates and awaits eager entries only, and fetches no deferred bundle at boot', async () => {
    const { moduleSystem, fetched, loader } = await bench(
      graph(row('eager'), row('dsh-panel', { lazy: true, slots: ['panel.list'], trigger: 'slot:panel.list' })),
      { eager: plugin(), 'dsh-panel': plugin() },
    )
    expect(fetched).toEqual(['/application'])
    expect([...loader.entries()].map(entry => entry.options.name)).toEqual(['eager'])
    expect(moduleSystem.deferredEntries()).toEqual([{ id: 'dsh-panel', slots: ['panel.list'], trigger: 'slot:panel.list' }])
    expect(moduleSystem.deferredStatus('dsh-panel')).toEqual({ id: 'dsh-panel', phase: 'pending' })
    expect(moduleSystem.deferredStatus('eager')).toBeUndefined()
  })

  it('materializes a deferred row on first need exactly once for concurrent triggers', async () => {
    const { moduleSystem, fetched, loader } = await bench(
      graph(row('eager'), row('dsh-panel', { lazy: true, slots: ['panel.list'] })),
      { eager: plugin(), 'dsh-panel': plugin() },
    )
    const changes: string[] = []
    const off = moduleSystem.onDeferredChange(() => {
      changes.push(moduleSystem.deferredStatus('dsh-panel')?.phase ?? 'gone')
    })
    const triggers = [moduleSystem.activateDeferred('dsh-panel'), moduleSystem.activateDeferred('dsh-panel')]
    await Promise.all(triggers)
    off()

    expect(fetched.filter(url => url.includes('dsh-panel'))).toHaveLength(1)
    expect([...loader.entries()].map(entry => entry.options.name).sort()).toEqual(['dsh-panel', 'eager'])
    expect(moduleSystem.deferredEntries()).toEqual([])
    expect(moduleSystem.deferredStatus('dsh-panel')).toEqual({ id: 'dsh-panel', phase: 'ready' })
    expect(changes).toEqual(['loading', 'ready'])
    // An eager row resolves immediately: it never had a deferred phase.
    await expect(moduleSystem.activateDeferred('eager')).resolves.toBeUndefined()
  })

  it('retries once, then reports the boot-audit failure text without breaking the app', async () => {
    // No factory for the deferred row: its bundle arrives without registering.
    const { moduleSystem, fetched, loader } = await bench(
      graph(row('eager'), row('dsh-broken', { lazy: true })),
      { eager: plugin() },
    )
    await expect(moduleSystem.activateDeferred('dsh-broken')).rejects
      .toThrow(/^dsh-broken: import failed: /)
    // One attempt plus one retry, then the failure is final.
    expect(fetched.filter(url => url.includes('dsh-broken'))).toHaveLength(2)
    expect(moduleSystem.deferredStatus('dsh-broken')?.phase).toBe('failed')
    expect([...loader.entries()].map(entry => entry.options.name)).toEqual(['eager'])
    // The page keeps working: the eager entry is still active and the row is retryable by hand.
    expect(loader.resolve([...loader.entries()][0]!.id).fiber?.state).toBe(2)
    expect(moduleSystem.deferredEntries().map(entry => entry.id)).toEqual(['dsh-broken'])
  })

  it('never materializes a deferred row through graph reconciliation', async () => {
    const { moduleSystem, fetched } = await bench(
      graph(row('eager'), row('dsh-panel', { lazy: true, slots: ['panel.list'] })),
      { eager: plugin(), 'dsh-panel': plugin() },
    )
    const next = graph(row('eager', { rev: 'r2' }), row('dsh-panel', { lazy: true, slots: ['panel.list'], rev: 'r2' }))
    await moduleSystem.entries.sync(next)
    expect(fetched.filter(url => url.includes('dsh-panel'))).toHaveLength(0)
    expect(moduleSystem.deferredStatus('dsh-panel')?.phase).toBe('pending')
  })
})

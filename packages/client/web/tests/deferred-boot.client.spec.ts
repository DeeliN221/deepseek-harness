// @vitest-environment jsdom
/**
 * Deferred rows at boot: `bootClient` creates and awaits eager rows only, and
 * a deferred row materializes on first need without ever failing boot.
 */
import { Context } from '@deepseek-ai/cordis'
import {
  createClientModuleSystem,
  type ClientBundleRegistration, type ClientModuleLoader, type ClientModuleLoaderTarget,
  type WebBootEntry, type WebBootGraph,
} from '@deepseek-ai/dsh-client-modules/client'
import { describe, expect, it, onTestFinished } from 'vitest'
import { bootClient, type EntryStateLabel } from '../src/boot-client.ts'

const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'

/** Graph with one application batch carrying every eager row. */
function graphOf(entries: WebBootEntry[]): WebBootGraph {
  const eager = entries.filter(entry => !entry.lazy).map(entry => entry.id)
  return {
    rev: 'graph',
    entries,
    batches: eager.length === 0 ? [] : [{ phase: 'application', url: '/application.js', rev: 'batch', entries: eager }],
  }
}

/** Module system over inline plugins; `loaded` records every transport call. */
function modulesOf(graph: WebBootGraph, staticModules: Record<string, unknown>): { modules: ClientModuleLoader; loaded: string[] } {
  const loaded: string[] = []
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: options => createClientModuleSystem(target, { id: BOOTSTRAP_ID, exports: {} }, options),
  }
  const modules = target.create({
    boot: graph,
    staticModules: Object.entries(staticModules).map(([id, exports]) => ({ id, factory: () => exports })),
    loadBundle: async (url) => { loaded.push(url) },
  })
  return { modules, loaded }
}

/** Recording progress sink. */
function stateSink(): { states: Map<string, EntryStateLabel[]>; onEntryState: (name: string, state: EntryStateLabel) => void } {
  const states = new Map<string, EntryStateLabel[]>()
  return { states, onEntryState: (name, state) => { states.set(name, [...(states.get(name) ?? []), state]) } }
}

describe('bootClient over deferred rows', () => {
  it('awaits eager rows only and reports no state for a deferred row', async () => {
    const graph = graphOf([
      { id: 'eager', url: '/eager.js', rev: '1' },
      { id: 'dsh-panel', url: '/panel.js', rev: '1', lazy: true, slots: ['panel.list'], trigger: 'slot:panel.list' },
    ])
    const { modules, loaded } = modulesOf(graph, { eager: { apply: () => {} } })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sink = stateSink()

    await bootClient({ ctx, modules, manifest: modules.manifest, onEntryState: sink.onEntryState })

    // Boot fetched nothing for the deferred row and never awaited it.
    expect(loaded).toEqual([])
    expect([...ctx.loader.entries()].map(entry => entry.options.name)).toEqual(['eager'])
    expect(sink.states.get('eager')?.at(-1)).toBe('active')
    expect(sink.states.has('dsh-panel')).toBe(false)
    expect(modules.deferredEntries()).toEqual([{ id: 'dsh-panel', slots: ['panel.list'], trigger: 'slot:panel.list' }])
  })

  it('materializes a deferred row on first need and keeps the boot audit on eager rows', async () => {
    const graph = graphOf([
      { id: 'eager', url: '/eager.js', rev: '1' },
      { id: 'dsh-panel', url: '/panel.js', rev: '1', lazy: true, slots: ['panel.list'] },
    ])
    const { modules } = modulesOf(graph, { eager: { apply: () => {} }, 'dsh-panel': { apply: () => {} } })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await bootClient({ ctx, modules, manifest: modules.manifest })

    await modules.activateDeferred('dsh-panel')

    expect([...ctx.loader.entries()].map(entry => entry.options.name).sort()).toEqual(['dsh-panel', 'eager'])
    expect(modules.deferredStatus('dsh-panel')).toEqual({ id: 'dsh-panel', phase: 'ready' })
    // The audit still runs over every created entry, now including the arrived row.
    expect([...ctx.loader.entries()]).toHaveLength(2)
  })

  it('keeps boot green when a deferred row never arrives, and surfaces its failure text', async () => {
    const graph = graphOf([
      { id: 'eager', url: '/eager.js', rev: '1' },
      { id: 'dsh-broken', url: '/broken.js', rev: '1', lazy: true, slots: ['panel.list'] },
    ])
    const { modules } = modulesOf(graph, { eager: { apply: () => {} } })
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })

    // Boot resolves: a broken deferred row is not a first-paint failure.
    await expect(bootClient({ ctx, modules, manifest: modules.manifest })).resolves.toBeUndefined()
    await expect(modules.activateDeferred('dsh-broken')).rejects.toThrow(/^dsh-broken: import failed: /)
    expect(modules.deferredStatus('dsh-broken')?.phase).toBe('failed')
  })
})

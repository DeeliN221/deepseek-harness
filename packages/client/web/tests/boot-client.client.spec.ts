// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import {
  createClientModuleSystem, parseBootManifest,
  type ClientBundleRegistration, type ClientModuleLoader, type ClientModuleLoaderTarget, type WebBootEntry, type WebBootGraph,
} from '@deepseek-ai/dsh-client-modules/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  auditEntries, bootClient, fatalFailures, requiredFailureReport, REQUIRED_CLIENT_ENTRY_IDS, type EntryStateLabel,
} from '../src/boot-client.ts'
import { FIBER_STATE } from '../src/loader-status.ts'

const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'

function graphOf(ids: readonly string[]): WebBootGraph {
  const entries: WebBootEntry[] = ids.map(id => ({ id, url: `/${id}.js`, rev: '1' }))
  return {
    rev: 'graph',
    entries,
    batches: [{ phase: 'application', url: '/application.js', rev: 'batch', entries: [...ids] }],
  }
}

/** Module system seeded with inline plugin modules; `loaded` records every transport call. */
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
    staticModules,
    loadBundle: async (url) => { loaded.push(url) },
  })
  return { modules, loaded }
}

/** Recording progress sink. */
function stateSink(): { states: Map<string, EntryStateLabel[]>; onEntryState: (name: string, state: EntryStateLabel) => void } {
  const states = new Map<string, EntryStateLabel[]>()
  return {
    states,
    onEntryState: (name, state) => { states.set(name, [...(states.get(name) ?? []), state]) },
  }
}

describe('bootClient', () => {
  it('activates every seeded row without touching the bundle transport', async () => {
    const graph = graphOf(['provider', 'consumer'])
    const { modules, loaded } = modulesOf(graph, {
      provider: { apply: (ctx: Context) => { ctx.reflect.provide('x', { marker: 'x' }) } },
      consumer: { inject: ['x'], apply: () => {} },
    })
    const ctx = new Context()
    const sink = stateSink()

    const failures = await bootClient({ ctx, modules, manifest: modules.manifest, onEntryState: sink.onEntryState })

    expect(failures).toEqual([])
    expect(loaded).toEqual([])
    const consumer = sink.states.get('consumer') ?? []
    expect(consumer[0]).toBe('loading')
    expect(consumer.at(-1)).toBe('active')
    expect(sink.states.get('provider')?.at(-1)).toBe('active')
    await ctx.fiber.dispose()
  })

  it('reports a row waiting on a service the roster never provides without failing the composition', async () => {
    const graph = graphOf(['orphan', 'healthy'])
    const { modules } = modulesOf(graph, {
      orphan: { inject: ['nothing'], apply: () => {} },
      healthy: { apply: () => {} },
    })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())

    const failures = await bootClient({ ctx, modules, manifest: modules.manifest })

    expect(failures).toEqual([{ id: 'orphan', reason: 'pending (waiting for service: nothing)' }])
    // The sibling still runs: only the orphaned consumer stays inactive.
    expect([...ctx.loader.entries()].some(entry => entry.options.name === 'healthy')).toBe(true)
  })

  it('reports and logs an import failure for a row that is neither seeded nor a graph row', async () => {
    const { modules } = modulesOf(graphOf(['seeded']), { seeded: { apply: () => {} } })
    const manifest = parseBootManifest(graphOf(['ghost']))
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    onTestFinished(() => { error.mockRestore() })
    const sink = stateSink()

    const failures = await bootClient({ ctx, modules, manifest, onEntryState: sink.onEntryState })

    expect(failures).toEqual([{ id: 'ghost', reason: 'import failed (see console for the import error)' }])
    expect(sink.states.get('ghost')).toEqual(['loading', 'failed'])
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0]?.[0]).toHaveProperty('message', expect.stringContaining('client-modules: cannot resolve'))
  })
})

describe('auditEntries', () => {
  interface FakeEntry { name: string; fiber?: { state: number; inject: Record<string, null> } }

  /** Loader-shaped double: entries with scripted fiber states, services by name. */
  function auditCtx(entries: readonly FakeEntry[], services: Record<string, unknown> = {}): Context {
    return {
      loader: {
        * entries() {
          for (const entry of entries) yield { options: { name: entry.name }, fiber: entry.fiber }
        },
      },
      get: (name: string) => services[name],
    } as unknown as Context
  }

  const silent = { importError: () => undefined }

  it('reports nothing when every entry is active', () => {
    expect(auditEntries(auditCtx([{ name: 'a', fiber: { state: FIBER_STATE.ACTIVE, inject: {} } }]), silent)).toEqual([])
  })

  it('names import failures, missing services, and other non-active states', () => {
    const ctx = auditCtx([
      { name: 'lost' },
      { name: 'waiting', fiber: { state: FIBER_STATE.PENDING, inject: { present: null, a: null, b: null } } },
      { name: 'opaque', fiber: { state: FIBER_STATE.PENDING, inject: {} } },
      { name: 'broken', fiber: { state: FIBER_STATE.FAILED, inject: {} } },
    ], { present: {} })

    expect(auditEntries(ctx, silent)).toEqual([
      { id: 'lost', reason: 'import failed (see console for the import error)' },
      { id: 'waiting', reason: 'pending (waiting for services: a, b)' },
      { id: 'opaque', reason: 'pending (waiting for services: unknown)' },
      { id: 'broken', reason: 'failed' },
    ])
  })

  it('names the recorded import error of a fiberless entry when the module system is supplied', () => {
    const recorded = new Map([['lost', new Error('client-modules: could not load "lost": plugins/??lost/client.js&rev=0: bundle script failed to load')]])
    const modules = { importError: (id: string) => recorded.get(id) }
    expect(auditEntries(auditCtx([{ name: 'lost' }, { name: 'quiet' }]), modules)).toEqual([
      {
        id: 'lost',
        reason: 'import failed: client-modules: could not load "lost": plugins/??lost/client.js&rev=0: bundle script failed to load',
      },
      { id: 'quiet', reason: 'import failed (see console for the import error)' },
    ])
  })
})

describe('startup policy', () => {
  it('keeps only the entries the shell cannot present without', () => {
    const failures = [
      { id: 'ui-conversation', reason: 'import failed' },
      { id: 'ui-layout', reason: 'failed' },
      { id: 'ui-skill', reason: 'pending (waiting for service: uiConversation)' },
    ]

    expect(fatalFailures(failures)).toEqual([{ id: 'ui-layout', reason: 'failed' }])
    expect([...REQUIRED_CLIENT_ENTRY_IDS].toSorted()).toEqual(['connection', 'ui-layout', 'ui-renderer'])
  })

  it('prevents external mutation of the required-entry policy', () => {
    expect(Object.isFrozen(REQUIRED_CLIENT_ENTRY_IDS)).toBe(true)
    expect(Reflect.set(REQUIRED_CLIENT_ENTRY_IDS, '0', 'ui-conversation')).toBe(false)
    expect(Reflect.deleteProperty(REQUIRED_CLIENT_ENTRY_IDS, '1')).toBe(false)
    expect(Reflect.set(REQUIRED_CLIENT_ENTRY_IDS, 'length', 0)).toBe(false)
    expect(() => Array.prototype.push.call(REQUIRED_CLIENT_ENTRY_IDS, 'ui-conversation')).toThrow(TypeError)

    const failures = ['connection', 'ui-layout', 'ui-renderer', 'ui-conversation'].map(id => ({ id, reason: 'failed' }))
    expect(fatalFailures(failures)).toEqual(failures.slice(0, 3))
    expect([...REQUIRED_CLIENT_ENTRY_IDS]).toEqual(['connection', 'ui-layout', 'ui-renderer'])
  })

  it('renders a required-entry report naming each failure once', () => {
    expect(requiredFailureReport('web boot', [{ id: 'connection', reason: 'failed' }])).toBe(
      'web boot: startup failed: 1 required entry did not activate\nconnection: failed',
    )
    expect(requiredFailureReport('web boot', [
      { id: 'connection', reason: 'failed' },
      { id: 'ui-renderer', reason: 'import failed' },
    ])).toBe([
      'web boot: startup failed: 2 required entries did not activate',
      'connection: failed',
      'ui-renderer: import failed',
    ].join('\n'))
  })
})

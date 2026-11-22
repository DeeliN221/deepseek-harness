/**
 * Wire-level deferral contract: parse rules, the eager closure that protects
 * service providers, and the operator roster.
 */
import { describe, expect, it } from 'vitest'
import {
  eagerClosureIds, parseBootManifest,
} from '../src/client/index.ts'
import type { WebBootEntry, WebBootGraph } from '../src/client/index.ts'
import { DEFAULT_DEFERRED_ROWS, DEFERRED_ROSTER_ENV, resolveDeferredRoster } from '../src/roster.ts'

/** One graph row with the single-resource combo reference the Host composes. */
const row = (id: string, extra: Partial<WebBootEntry> = {}): WebBootEntry => ({
  id,
  url: `plugins/??${id}/client.js&rev=r1`,
  rev: 'r1',
  ...extra,
})

/** Graph whose only batch holds the eager rows. */
const graph = (entries: WebBootEntry[], batch = entries.filter(entry => !entry.lazy).map(entry => entry.id)): WebBootGraph => ({
  rev: 'graph',
  entries,
  batches: batch.length === 0 ? [] : [{ phase: 'application', url: 'plugins/??batch&rev=b', rev: 'b', entries: batch }],
})

describe('deferred graph rows', () => {
  it('keeps a deferred row in the graph and out of every batch', () => {
    const manifest = parseBootManifest(graph([row('eager'), row('lazy', { lazy: true, slots: ['panel.list'], trigger: 'slot:panel.list' })]))
    const plugins = new Map(manifest.plugins.map(plugin => [plugin.id, plugin]))
    expect(plugins.get('eager')).toMatchObject({ lazy: false, slots: [] })
    expect(plugins.get('lazy')).toMatchObject({ lazy: true, slots: ['panel.list'], trigger: 'slot:panel.list' })
    const modules = new Map(manifest.modules.map(module => [module.id, module]))
    // A deferred row loads from its own single-resource reference, never from a batch.
    expect(modules.get('lazy')?.initialUrl).toBe(modules.get('lazy')?.url)
    expect(modules.get('eager')?.initialUrl).toBe('plugins/??batch&rev=b')
    expect(manifest.plugins.filter(plugin => plugin.lazy).map(plugin => plugin.id)).toEqual(['lazy'])
  })

  it('rejects a deferred row that a batch still carries', () => {
    expect(() => parseBootManifest({
      rev: 'graph',
      entries: [row('lazy', { lazy: true })],
      batches: [{ phase: 'application', url: 'plugins/??batch&rev=b', rev: 'b', entries: ['lazy'] }],
    })).toThrow(/deferred entry "lazy" must not belong to the application batch/)
  })

  it('rejects malformed deferral metadata at the wire boundary', () => {
    expect(() => parseBootManifest({
      rev: 'graph',
      entries: [{ ...row('x'), lazy: false }],
      batches: [],
    })).toThrow(/lazy must be true when present/)
    expect(() => parseBootManifest({
      rev: 'graph',
      entries: [{ ...row('x'), trigger: 7 }],
      batches: [],
    })).toThrow(/trigger must be a string/)
    expect(() => parseBootManifest({
      rev: 'graph',
      entries: [{ ...row('x'), slots: ['ok', 7] }],
      batches: [],
    })).toThrow(/slots must be a string array/)
  })
})

describe('eager closure', () => {
  it('promotes a deferred row that an eager row injects, whatever the declaration order', () => {
    const provider = { id: 'service-provider', lazy: true }
    const consumer = { id: 'consumer', inject: ['service-provider'] }
    // Provider first, then its consumer: the naive single pass would keep the provider lazy.
    expect([...eagerClosureIds([provider, consumer])].sort()).toEqual(['consumer', 'service-provider'])
    // Consumer first, then its provider: same closure, so order cannot decide the outcome.
    expect([...eagerClosureIds([consumer, provider])].sort()).toEqual(['consumer', 'service-provider'])
    // A lazy row nothing eager injects stays out of the closure.
    expect([...eagerClosureIds([provider, consumer, { id: 'unused', lazy: true }])].sort())
      .toEqual(['consumer', 'service-provider'])
  })

  it('walks the inject graph transitively from an eager seed', () => {
    // eager → A (promoted) → B (promoted) even though only A is injected directly.
    const rows = [
      { id: 'eager', inject: ['a'] },
      { id: 'a', inject: ['b'], lazy: true },
      { id: 'b', lazy: true },
      { id: 'c', lazy: true },
    ]
    expect([...eagerClosureIds(rows)].sort()).toEqual(['a', 'b', 'eager'])
  })

  it('normalizes a promoted deferred row back to eager when the graph is parsed', () => {
    const manifest = parseBootManifest(graph([
      row('consumer', { inject: ['provider'] }),
      row('provider', { lazy: true, slots: ['panel.list'] }),
    ]))
    const plugins = new Map(manifest.plugins.map(plugin => [plugin.id, plugin]))
    expect(plugins.get('provider')?.lazy).toBe(false)
    // The graph was composed while the row was still deferred, so it is in no
    // batch; a promoted row keeps its single-resource fallback and becomes an
    // ordinary eager row from here on.
    expect(manifest.modules.find(module => module.id === 'provider')?.initialUrl)
      .toBe('plugins/??service-provider/client.js&rev=r1'.replace('service-provider', 'provider'))
  })
})

describe('deferred roster', () => {
  it('ships an explicit default list and nothing else', () => {
    const roster = resolveDeferredRoster(DEFAULT_DEFERRED_ROWS)
    expect(roster.rows.size).toBe(DEFAULT_DEFERRED_ROWS.length)
    expect(roster.rows.has('@deepseek-ai/dsh-client-ui-schedule')).toBe(true)
    expect(roster.removed.size).toBe(0)
    // The bootstrap module and stage-one infrastructure are never in it.
    expect(roster.rows.has('@deepseek-ai/dsh-client-modules')).toBe(false)
    expect(roster.rows.has('@deepseek-ai/dsh-client-ui-renderer')).toBe(false)
  })

  it('adds and vetoes rows from operator tokens without a rebuild', () => {
    const roster = resolveDeferredRoster(DEFAULT_DEFERRED_ROWS, '-@deepseek-ai/dsh-client-ui-schedule +dsh-im extra-plugin')
    expect(roster.rows.has('extra-plugin')).toBe(true)
    expect(roster.rows.has('dsh-im')).toBe(true)
    expect(roster.removed.has('@deepseek-ai/dsh-client-ui-schedule')).toBe(true)
    expect(roster.rows.has('@deepseek-ai/dsh-client-ui-schedule')).toBe(false)
    expect(DEFERRED_ROSTER_ENV).toBe('DSH_CLIENT_DEFERRED')
  })
})

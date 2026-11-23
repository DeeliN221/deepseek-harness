/**
 * Host composition of deferred rows: the bytes are saved at composition time —
 * a deferred row is in no batch, so neither the application combo nor its
 * `<head>` preload carries it — and dependency safety promotes a deferred
 * service provider back to eager.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { bootInjections, ClientModuleRegistry } from '../src/index.ts'
import type { WebBootGraph } from '../src/client/index.ts'

const RENDERER_ID = '@deepseek-ai/dsh-client-ui-renderer'
const SCHEDULE_ID = '@deepseek-ai/dsh-client-ui-schedule'
const DEFERRED_ENV = 'DSH_CLIENT_DEFERRED'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
  delete process.env.DSH_CLIENT_DEFERRED
})

/** Write one resolvable package whose client bundle exists and declares the supplied `dsh.client`. */
function writePackage(packageName: string, client: Record<string, unknown> = {}): void {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-deferred-graph-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  mkdirSync(join(pkgRoot, 'lib'), { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: { './client': './lib/client.js', './package.json': './package.json' },
    dsh: { client: { platform: 'web', ...client } },
  }))
  writeFileSync(join(pkgRoot, 'lib', 'client.js'), 'module.exports = {}\n')
}

/** Construct the node-half service over the supplied package names. */
function construct(packageNames: readonly string[]): ClientModuleRegistry {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root ?? '.').href}/`
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield {
          options: { name: packageName },
          fiber: {},
          disabled: false,
          parent: { tree: { ctx: { baseUrl: ctx.baseUrl } } },
        }
      }
    },
  })
  return new ClientModuleRegistry(ctx)
}

/** Every script URL the index preloads. */
function preloaded(graph: WebBootGraph): string[] {
  return bootInjections(graph)
    .filter(row => row.kind === 'script-preload')
    .map(row => row.src)
}

describe('deferred rows in the composed graph', () => {
  it('drops a roster row out of every batch and out of the preload set', () => {
    writePackage(RENDERER_ID, { immediately: true })
    writePackage(SCHEDULE_ID)
    const graph = construct([RENDERER_ID, SCHEDULE_ID]).graph()

    const deferred = graph.entries.find(entry => entry.id === SCHEDULE_ID)
    expect(deferred).toMatchObject({ lazy: true, trigger: 'slot:sidebar.panellist', slots: ['sidebar.panellist'] })
    const batches = graph.batches.flatMap(batch => batch.entries)
    expect(batches).toEqual([RENDERER_ID])
    const loads = preloaded(graph)
    expect(loads).toHaveLength(1)
    expect(loads[0]).not.toContain('ui-schedule')
    // The deferred row keeps its own single-resource reference for first need.
    expect(deferred?.url).toContain(`${SCHEDULE_ID}/client.js`)
  })

  it('keeps panels and commands without a connected slot trigger available at boot', () => {
    const ids = ['dsh-context', 'dsh-obsidian-ignis', 'dsh-session-fts']
    for (const id of ids) writePackage(id)
    const graph = construct(ids).graph()
    expect(graph.entries.every(entry => entry.lazy === undefined)).toBe(true)
    expect(graph.batches.flatMap(batch => batch.entries).sort()).toEqual([...ids].sort())
  })

  it('keeps workflow node definitions eager before conversation kind dispatch', () => {
    const workflow = '@deepseek-ai/dsh-client-ui-workflow-run'
    writePackage(RENDERER_ID, { immediately: true })
    writePackage(workflow, { inject: [RENDERER_ID] })
    const graph = construct([RENDERER_ID, workflow]).graph()

    // The module registers the workflow node kind itself. Until it boots, the
    // existing unknown-kind renderer prevents a missing-slot activation.
    expect(graph.entries.find(entry => entry.id === workflow)?.lazy).toBeUndefined()
    expect(graph.batches.flatMap(batch => batch.entries)).toEqual([RENDERER_ID, workflow])
  })

  it('keeps stage-one infrastructure eager even when the roster names it', () => {
    writePackage(RENDERER_ID, { immediately: true })
    process.env[DEFERRED_ENV] = `+${RENDERER_ID}`
    const graph = construct([RENDERER_ID]).graph()
    expect(graph.entries.find(entry => entry.id === RENDERER_ID)?.lazy).toBeUndefined()
    expect(graph.batches.flatMap(batch => batch.entries)).toEqual([RENDERER_ID])
  })

  it('honours an operator veto that forces a default deferred row back to eager', () => {
    writePackage(SCHEDULE_ID)
    process.env[DEFERRED_ENV] = `-${SCHEDULE_ID}`
    const graph = construct([SCHEDULE_ID]).graph()
    expect(graph.entries[0]?.lazy).toBeUndefined()
    expect(graph.batches.flatMap(batch => batch.entries)).toEqual([SCHEDULE_ID])
  })

  it('promotes a deferred provider an eager row injects, whatever order the rows compose in', () => {
    writePackage('provider')
    writePackage('consumer', { inject: ['provider'] })
    process.env[DEFERRED_ENV] = '+provider'
    const graph = construct(['provider', 'consumer']).graph()
    expect(graph.entries.find(entry => entry.id === 'provider')?.lazy).toBeUndefined()
    expect(graph.batches.flatMap(batch => batch.entries).sort()).toEqual(['consumer', 'provider'])
    expect(preloaded(graph)).toHaveLength(1)
  })
})

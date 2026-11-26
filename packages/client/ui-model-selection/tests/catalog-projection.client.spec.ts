/** Confirmed Session projections remain current while model metadata refreshes. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ModelCatalog, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-agent/types'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ProjectionValueStore } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/projection-store.ts'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'
import { ModelDirectory } from '../src/client/directory.ts'

const original: ModelSelection = { provider: 'provider', model: 'flash' }
const low = brandString<ReasoningEffortId>('low')
const data: ModelCatalog = {
  default: original,
  routableProviders: ['provider'],
  groups: [{ id: 'provider', name: 'Provider', models: [
    { id: 'flash', name: 'Flash', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
    { id: 'pro', name: 'Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
  ] }],
  failures: [],
}

async function bench(known = true, options: { beforeSwitch?: () => string | null; openSession?: (id: SessionId) => void } = {}) {
  const ctx = new Context()
  const refresh = Promise.withResolvers<RemoteResult<ModelCatalog>>()
  const sessionRemote = {
    modelCatalog: vi.fn<() => Promise<RemoteResult<ModelCatalog>>>()
      .mockResolvedValueOnce({ ok: true, value: data })
      .mockImplementation(() => refresh.promise),
    selectModel: vi.fn(async () => ({ ok: true as const, value: { selected: original } })),
  }
  Object.assign(new TestRemote(ctx), { session: sessionRemote })
  ctx.reflect.provide('remote.session', sessionRemote)
  const catalog = new ModelCatalogDirectory(ctx)
  await catalog.load()
  const projections = new ProjectionValueStore()
  if (known) projections.seed({ asOfSeq: SessionSeq(0), values: { modelSelection: { lastUsed: null, next: null } } })
  const directory = new ModelDirectory(sessionRemote, 'projection-refresh' as SessionId,
    () => true, catalog, projections.faceOf('modelSelection'), () => true, undefined,
    options.openSession, options.beforeSwitch)
  let seq = 0
  const publish = async (next: ModelSelection | null) => {
    const value: ModelSelectionProjection = { lastUsed: null, next }
    projections.apply('modelSelection', value, SessionSeq(++seq))
    await vi.waitFor(() => expect(projections.faceOf('modelSelection').getSnapshot()).toEqual(value))
    // ProjectionValueStore publishes its subscribed face in a microtask.
    await Promise.resolve()
  }
  onTestFinished(async () => {
    directory.dispose()
    refresh.resolve({ ok: true, value: data })
    await Promise.allSettled([refresh.promise])
    await ctx.fiber.dispose()
  })
  return { catalog, directory, projections, publish, refresh, sessionRemote }
}

describe('model selection during catalog refresh', () => {
  it.each(['loading', 'error'] as const)('uses projected effort and model while metadata is %s', async (phase) => {
    const b = await bench()
    b.catalog.refresh()
    if (phase === 'error') {
      b.refresh.reject(new Error('catalog offline'))
      await vi.waitFor(() => expect(b.catalog.store.getSnapshot().status).toBe('error'))
    }
    for (const selection of [{ ...original, reasoningEffort: low }, { provider: 'provider', model: 'pro', reasoningEffort: low }]) {
      await b.publish(selection)
      expect(b.directory.store.getSnapshot()).toMatchObject({
        current: selection, status: phase, error: phase === 'error' ? 'catalog offline' : null, routable: null,
      })
      expect(b.directory.store.getSnapshot().groups).toBe(data.groups)
      expect(b.directory.store.getSnapshot().failures).toBe(data.failures)
    }
  })

  it('uses a new confirmed selection before the replacement Host catalog loads', async () => {
    const b = await bench()
    b.projections.clear()
    b.catalog.resetGeneration()
    const selection = { provider: 'provider', model: 'pro', reasoningEffort: low }
    await b.publish(selection)
    expect(b.directory.store.getSnapshot()).toMatchObject({ current: selection, groups: [], routable: null, status: 'loading' })
  })

  it('does not infer a confirmed selection before the projection initializes', async () => {
    const b = await bench(false)
    b.catalog.refresh()
    expect(b.directory.store.getSnapshot()).toMatchObject({ current: null, routable: null, status: 'loading' })
  })

  it('uses the known catalog default when an initialized projection has no explicit selection', async () => {
    const b = await bench()
    await b.publish({ provider: 'provider', model: 'pro' })
    b.catalog.refresh()
    await b.publish(null)
    expect(b.directory.store.getSnapshot()).toMatchObject({ current: original, routable: null, status: 'loading' })
  })


  it('refuses the Session-replacing selection when the draft guard blocks it', async () => {
    const opened: string[] = []
    const b = await bench(true, { beforeSwitch: () => 'draft present', openSession: (id) => { opened.push(String(id)) } })
    b.sessionRemote.selectModel.mockResolvedValueOnce({ ok: true, value: { selected: { provider: 'provider', model: 'pro' }, sessionId: 'target' } } as never)
    const result = await b.directory.select({ provider: 'provider', model: 'pro' })
    expect(result.ok).toBe(false)
    expect(opened).toEqual([])
    expect(b.directory.store.getSnapshot().error).toBe('draft present')
  })

  it('opens the replacement Session when the draft guard allows it', async () => {
    const opened: string[] = []
    const b = await bench(true, { beforeSwitch: () => null, openSession: (id) => { opened.push(String(id)) } })
    b.sessionRemote.selectModel.mockResolvedValueOnce({ ok: true, value: { selected: { provider: 'provider', model: 'pro' }, sessionId: 'target' } } as never)
    const result = await b.directory.select({ provider: 'provider', model: 'pro' })
    expect(result.ok).toBe(true)
    expect(opened).toEqual(['target'])
  })

  it('waits for the projection after a successful selection RPC', async () => {
    const b = await bench()
    const selection = { ...original, reasoningEffort: low }
    b.sessionRemote.selectModel.mockResolvedValueOnce({ ok: true, value: { selected: selection } })
    b.catalog.refresh()
    await b.directory.select(selection)
    expect(b.directory.store.getSnapshot().current).toEqual(original)
    await b.publish(selection)
    expect(b.directory.store.getSnapshot().current).toEqual(selection)
  })
})

// @vitest-environment jsdom
/** Deferred-provider rendering: an empty deferred slot shows a skeleton, then the real registration. */
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import {
  SlotCore, type PropsRenderSlots, type SlotRendererHost, type SlotScopeAdapter, type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'deferred.panel': { kind: 'single'; scope: 'root' }
    'deferred.list': { kind: 'list'; scope: 'root' }
  }
}

type FrameSlots = PropsRenderSlots<'deferred.panel' | 'deferred.list'>

/** Passthrough host over the real core, including the deferral read. */
function hostOver(core: SlotCore): SlotRendererHost {
  const absentBinding: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const bindingSource = { getSnapshot: () => absentBinding, subscribe: () => () => {} }
  const sessionAdapter: SlotScopeAdapter = { current: bindingSource, bindingSource: () => bindingSource }
  return {
    subscribe: (key, fn) => core.subscribe(key, fn),
    getVersion: key => core.getVersion(key),
    entriesOf: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => { core.reportEntryError(key, entry, error, info) },
    reportFactoryError: (name, definition, error) => { core.reportFactoryError(name, definition, error) },
    specOf: key => core.specDynamic(key),
    deferralOf: key => core.deferralOf(key),
    isLive: entry => core.isLive(entry),
    storeOf: () => undefined,
    factoryStoreOf: () => undefined,
    retainFactoryOccurrence: () => () => {},
    subscribeFactory: (name, fn) => core.subscribeFactory(name, fn),
    getFactoryVersion: name => core.factoryVersion(name),
    factoryOf: name => core.factory(name),
    isFactoryLive: definition => core.isFactoryLive(definition),
    root: bindingSource,
    scopeRevision: { getSnapshot: () => 0, subscribe: () => () => {} },
    scope: () => sessionAdapter,
  }
}

/** Register the root frame declaring both keys, then mount the renderer. */
function mountFrame(core: SlotCore, body: (renderSlot: FrameSlots['renderSlot']) => React.ReactNode) {
  const dispose = core.register({
    name: 'root',
    children: {
      'deferred.panel': { kind: 'single', scope: 'root' },
      'deferred.list': { kind: 'list', scope: 'root' },
    },
  }, (props: FrameSlots) => <>{body(props.renderSlot)}</>)
  const view = render(<>{createSlotRenderer().renderRoot(hostOver(core), {})}</>)
  return { view, dispose }
}

/** Let the microtask-batched slot notifications flush into a re-render. */
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve() }) }

describe('deferred slot face', () => {
  it('renders a skeleton while the deferred provider is missing and runs its trigger once', async () => {
    const core = new SlotCore()
    const activate = vi.fn()
    core.declareDeferredSlot({ key: 'deferred.panel', entry: 'dsh-panel', trigger: 'slot:deferred.panel', activate })
    const { view, dispose } = mountFrame(core, renderSlot => renderSlot('deferred.panel', {}))

    expect(view.container.querySelector('[data-slot-deferred="deferred.panel"]')).not.toBeNull()
    expect(view.container.querySelector('[data-slot-deferred-entry="dsh-panel"]')).not.toBeNull()
    expect(activate).toHaveBeenCalledTimes(1)

    // The real registration replaces the skeleton through ordinary dispatch.
    const disposeEntry = core.register({ name: 'deferred.panel' }, () => <span data-panel>panel ready</span>)
    await flush()
    expect(view.container.querySelector('[data-panel]')?.textContent).toBe('panel ready')
    expect(view.container.querySelector('[data-slot-deferred]')).toBeNull()
    disposeEntry()
    view.unmount()
    dispose()
  })

  it('renders the entry failure text instead of a blank when the deferred row never arrives', async () => {
    const core = new SlotCore()
    core.declareDeferredSlot({ key: 'deferred.panel', entry: 'dsh-broken', activate: () => {} })
    const { view, dispose } = mountFrame(core, renderSlot => renderSlot('deferred.panel', {}))
    core.setDeferredPhase('dsh-broken', 'loading')
    await flush()
    expect(view.container.querySelector('[data-slot-deferred="deferred.panel"]')).not.toBeNull()

    core.setDeferredPhase('dsh-broken', 'failed', 'dsh-broken: import failed: bundle 404')
    await flush()
    const failed = view.container.querySelector('[data-slot-deferred-failed="dsh-broken"]')
    expect(failed?.textContent).toContain('dsh-broken: import failed: bundle 404')
    expect(view.container.querySelector('[data-slot-deferred]')).toBeNull()
    view.unmount()
    dispose()
  })

  it('appends the skeleton to a list slot that already has rows', async () => {
    const core = new SlotCore()
    const { view, dispose } = mountFrame(core, renderSlot => renderSlot('deferred.list', {}))
    // The row and the hint arrive after the declaring frame, as a runtime
    // registration and a boot-time roster hint do.
    const disposeEntry = core.register({ name: 'deferred.list', id: 'ready-row' }, () => <span data-row>ready</span>)
    core.declareDeferredSlot({ key: 'deferred.list', entry: 'dsh-panel', activate: () => {} })
    await flush()

    expect(view.container.querySelector('[data-row]')).not.toBeNull()
    expect(view.container.querySelector('[data-slot-deferred="deferred.list"]')).not.toBeNull()
    core.setDeferredPhase('dsh-panel', 'ready')
    await flush()
    expect(view.container.querySelector('[data-slot-deferred="deferred.list"]')).toBeNull()
    expect(view.container.querySelector('[data-row]')).not.toBeNull()
    view.unmount()
    disposeEntry()
    dispose()
  })
})

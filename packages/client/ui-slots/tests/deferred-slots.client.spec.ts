/**
 * Deferred-provider hints in the pure slot core: a hint marks an empty slot as
 * loading rather than absent, phases follow the entry, and a registration makes
 * the hint irrelevant.
 */
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '../src/index.ts'

describe('deferred slot hints', () => {
  it('exposes a pending hint whose trigger the outlet runs', () => {
    const core = new SlotCore()
    const activate = vi.fn()
    core.declareDeferredSlot({ key: 'panel.list', entry: 'dsh-panel', trigger: 'slot:panel.list', activate })
    expect(core.deferralOf('panel.list')).toEqual({
      entry: 'dsh-panel',
      phase: 'pending',
      activate: expect.any(Function),
    })
    core.deferralOf('panel.list')?.activate()
    expect(activate).toHaveBeenCalledOnce()
    activate.mockClear()
    // The core never triggers by itself: the outlet that renders the empty cell owns first need.
    expect(activate).not.toHaveBeenCalled()
    expect(core.deferralOf('other.slot')).toBeUndefined()
  })

  it('tracks one entry across every slot it declared, and hides on ready', () => {
    const core = new SlotCore()
    const activate = vi.fn()
    core.declareDeferredSlot({ key: 'a.slot', entry: 'dsh-panel', activate })
    core.declareDeferredSlot({ key: 'b.slot', entry: 'dsh-panel', activate })
    core.setDeferredPhase('dsh-panel', 'loading')
    expect(core.deferralOf('a.slot')?.phase).toBe('loading')
    expect(core.deferralOf('b.slot')?.phase).toBe('loading')
    core.setDeferredPhase('dsh-panel', 'failed', 'dsh-panel: import failed: boom')
    expect(core.deferralOf('a.slot')).toMatchObject({ phase: 'failed', message: 'dsh-panel: import failed: boom' })
    core.setDeferredPhase('dsh-panel', 'ready')
    expect(core.deferralOf('a.slot')).toBeUndefined()
    expect(core.deferralOf('b.slot')).toBeUndefined()
  })

  it('notifies the slot key so outlets re-render, and drops the hint with its disposer', async () => {
    const core = new SlotCore()
    const seen: string[] = []
    core.subscribe('panel.list', () => { seen.push('panel.list') })
    const dispose = core.declareDeferredSlot({ key: 'panel.list', entry: 'dsh-panel', activate: () => {} })
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    core.setDeferredPhase('dsh-panel', 'loading')
    await Promise.resolve()
    expect(seen).toHaveLength(2)
    dispose()
    expect(core.deferralOf('panel.list')).toBeUndefined()
    await Promise.resolve()
    expect(seen).toHaveLength(3)
  })
})

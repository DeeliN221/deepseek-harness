import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceSearchHandler } from '../src/client/search-handler.ts'
import { createWorkspaceShortcutControls } from '../src/client/shortcuts.ts'

describe('unified Workspace search', () => {
  it('uses native search without a provider, handles once and restores fallback on disposal', () => {
    const router = createWorkspaceSearchHandler()
    const controls = createWorkspaceShortcutControls(router.dispatch)
    controls.search()
    expect(controls.state.getSnapshot().searchRequest).toBe(1)
    const open = vi.fn(() => true)
    const dispose = router.register(open)
    controls.search()
    expect(open).toHaveBeenCalledOnce()
    expect(controls.state.getSnapshot().searchRequest).toBe(1)
    dispose(); dispose(); controls.search()
    expect(controls.state.getSnapshot().searchRequest).toBe(2)
  })
  it('elects only the latest provider and does not remove its replacement during HMR', () => {
    const router = createWorkspaceSearchHandler()
    const old = vi.fn(() => true), next = vi.fn(() => true)
    const removeOld = router.register(old), removeNext = router.register(next)
    expect(router.dispatch()).toBe(true)
    removeOld(); expect(router.dispatch()).toBe(true)
    expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(2)
    removeNext(); expect(router.dispatch()).toBe(false)
  })
  it('uses native search when the overlay is not ready or its opener fails', () => {
    const router = createWorkspaceSearchHandler()
    const controls = createWorkspaceShortcutControls(router.dispatch)
    router.register(() => false); controls.search()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    router.register(() => { throw new Error('unmounted') }); controls.search()
    expect(controls.state.getSnapshot().searchRequest).toBe(2)
    expect(warn).toHaveBeenCalledOnce(); warn.mockRestore()
  })
})

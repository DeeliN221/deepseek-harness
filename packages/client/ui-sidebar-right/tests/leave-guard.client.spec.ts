// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { controllerHarness, SESSION } from './controller-harness.client.ts'
import { intentsFor } from '../src/client/shell/SidebarRight.tsx'

const dispose: (() => void)[] = []
afterEach(() => { for (const cleanup of dispose.splice(0)) cleanup() })

function setup() {
  const h = controllerHarness()
  h.publish()
  dispose.push(() => { h.controller.tabDomain.dispose(); h.unadopt() })
  h.controller.openResource('dsh-resource://file/session/s-test/a.txt')
  h.controller.openResource('dsh-resource://file/session/s-test/b.txt')
  const a = h.tabOf('a.txt')
  const b = h.tabOf('b.txt')
  const occurrence = h.controller.tabDomain.occurrence(SESSION, { id: b })
  const beforeLeave = vi.fn(() => false)
  occurrence.tabActions.setLeaveGuard({ beforeLeave, hasUnsavedChanges: () => true })
  return { ...h, a, b, occurrence, beforeLeave }
}

describe('retained tab leave guards', () => {
  it('vetoes close, replacement, new-file opening, reveal, focus and collapse before a commit', () => {
    const h = setup()
    const previous = h.layout()
    h.controller.close(h.b)
    h.controller.openResource('dsh-resource://file/session/s-test/new.txt', { replaceTab: h.b })
    h.controller.openResource('dsh-resource://file/session/s-test/new.txt')
    h.controller.openResource('dsh-resource://file/session/s-test/a.txt')
    h.controller.focus(h.a)
    h.controller.toggleExpanded()
    expect(h.layout()).toBe(previous)
    expect(h.beforeLeave).toHaveBeenCalledWith('close')
    expect(h.beforeLeave).toHaveBeenCalledWith('switch')
    h.beforeLeave.mockReturnValue(true)
    h.controller.focus(h.a)
    expect(getPane(h.layout(), h.layout().activePaneId).activeTabId).toBe(h.a)
    expect(h.occurrence.signal.aborted).toBe(false)
    h.controller.close(h.b)
    expect(h.occurrence.signal.aborted).toBe(true)
  })

  it('routes the dock tab click through the same guarded controller', () => {
    const h = setup()
    const intents = intentsFor(SESSION, h.instance.actions, kind => h.controller.openTab(kind),
      id => h.controller.closeIn(SESSION, id), undefined, id => h.controller.focusIn(SESSION, id))
    intents.focusTab(h.a)
    expect(getPane(h.layout(), h.layout().activePaneId).activeTabId).toBe(h.b)
    h.beforeLeave.mockReturnValue(true)
    intents.focusTab(h.a)
    expect(getPane(h.layout(), h.layout().activePaneId).activeTabId).toBe(h.a)
  })

  it('keeps inactive drafts protected on browser unload and releases the listener at tab disposal', () => {
    const h = setup()
    const releaseCommands = h.occurrence.tabActions.bindCommands({ refresh: vi.fn() })
    releaseCommands() // A body unmounts; its separate draft guard survives.
    const refresh = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refresh)
    expect(refresh.defaultPrevented).toBe(true)
    h.beforeLeave.mockReturnValue(true)
    h.controller.focus(h.a)
    const inactive = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(inactive)
    expect(inactive.defaultPrevented).toBe(true)
    h.controller.close(h.b)
    const closed = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closed)
    expect(closed.defaultPrevented).toBe(false)
  })

  it('replaces a guard without retaining an older unload callback', () => {
    const h = setup()
    h.occurrence.tabActions.setLeaveGuard({ beforeLeave: () => true, hasUnsavedChanges: () => false })
    const refresh = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refresh)
    expect(refresh.defaultPrevented).toBe(false)
    h.controller.close(h.b)
    expect(h.occurrence.signal.aborted).toBe(true)
  })
})

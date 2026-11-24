// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AsyncDispatchControl } from '../src/client/skeleton/AsyncDispatchControl.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function props(checked = false): ComponentProps<typeof AsyncDispatchControl> {
  return {
    useSession: (select => select({ subagent: null, removed: false } as never)) as ComponentProps<typeof AsyncDispatchControl>['useSession'],
    useProjection: (() => checked) as ComponentProps<typeof AsyncDispatchControl>['useProjection'],
    useAccess: (() => true) as ComponentProps<typeof AsyncDispatchControl>['useAccess'],
    locked: false, reportFailure: vi.fn(), dismiss: vi.fn(), openPane: vi.fn(),
    t: (key => zh[key as keyof typeof zh] ?? key) as ComponentProps<typeof AsyncDispatchControl>['t'],
    save: vi.fn(async () => null),
  } as ComponentProps<typeof AsyncDispatchControl>
}
describe('async dispatch menu item', () => {
  it('keeps the committed check while saving, blocks repeat activation and reports a rejected save', async () => {
    let finish!: (error: string | null) => void
    const p = props(true)
    p.save = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const view = render(<AsyncDispatchControl {...p} />)
    const row = screen.getByRole('menuitemcheckbox', { name: /异步派发/ })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(row)
    fireEvent.click(row)
    expect(p.save).toHaveBeenCalledExactlyOnceWith(false)
    expect(row.getAttribute('aria-busy')).toBe('true')
    expect(row.getAttribute('aria-checked')).toBe('true')
    await act(async () => { finish('保存失败') })
    expect(p.reportFailure).toHaveBeenCalledWith('保存失败')
    expect(row.getAttribute('aria-checked')).toBe('true')
    view.rerender(<AsyncDispatchControl {...p} useProjection={props(false).useProjection} />)
    expect(row.getAttribute('aria-checked')).toBe('false')
  })
  it('reports transport failure and recovers the pending state', async () => {
    const p = props()
    p.save = vi.fn(async () => { throw new Error('offline') })
    render(<AsyncDispatchControl {...p} />)
    fireEvent.click(screen.getByRole('menuitemcheckbox'))
    await waitFor(() => expect(p.reportFailure).toHaveBeenCalledWith('保存失败: Error: offline'))
    expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-busy')).toBe('false')
  })
  it.each(['locked', 'removed', 'denied'] as const)('does not write when %s', reason => {
    const p = props()
    if (reason === 'locked') p.locked = true
    if (reason === 'removed') p.useSession = (select => select({ subagent: null, removed: true } as never)) as typeof p.useSession
    if (reason === 'denied') p.useAccess = (() => false) as typeof p.useAccess
    render(<AsyncDispatchControl {...p} />)
    const row = screen.getByRole('menuitemcheckbox')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(row)
    expect(p.save).not.toHaveBeenCalled()
  })
  it('omits the option for a subagent session', () => {
    const p = props()
    p.useSession = (select => select({ subagent: {} } as never)) as typeof p.useSession
    render(<AsyncDispatchControl {...p} />)
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })
})

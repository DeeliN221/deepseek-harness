// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RunningStatus } from '../src/client/chat/RunningStatus.tsx'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

function statusHarness(startTime?: number) {
  const view = render(<RunningStatus startTime={startTime} paused={false} t={t} />)
  return {
    ...view,
    set: (nextStartTime?: number, paused = false, stopRequestedAt?: number, endTime?: number) => {
      view.rerender(<RunningStatus startTime={nextStartTime} paused={paused}
        stopRequestedAt={stopRequestedAt} endTime={endTime} t={t} />)
    },
  }
}

describe('composer Turn clock', () => {
  it('waits for a recorded start and clears its interval when the reading disappears', () => {
    const view = statusHarness()
    expect(view.queryByRole('timer')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.getByRole('timer').textContent).toBe('0:04')
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.queryByRole('timer')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('updates digital seconds with a clear accessible name and no live announcements', () => {
    const view = statusHarness(1_000)
    const timer = view.getByRole('timer', { name: '用时 4秒' })
    expect(timer.getAttribute('aria-live')).toBe('off')
    expect(view.queryByRole('status')).toBeNull()
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(view.getByRole('timer')).toBe(timer)
    expect(timer.textContent).toBe('0:06')
    expect(timer.getAttribute('aria-label')).toBe('用时 6秒')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('freezes on local stop intent and resumes if the stop is rejected', () => {
    const view = statusHarness(1_000)
    view.set(1_000, false, 5_000)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(view.getByRole('timer').textContent).toBe('0:04')
    view.set(1_000)
    expect(view.getByRole('timer').textContent).toBe('0:09')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('retains the recorded final duration after completion and remount', () => {
    const view = statusHarness(1_000)
    view.set(1_000, true, undefined, 4_000)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(view.getByRole('timer').textContent).toBe('0:03')
    view.unmount()
    const reopened = render(<RunningStatus startTime={1_000} endTime={4_000} paused={true} t={t} />)
    expect(reopened.getByRole('timer').textContent).toBe('0:03')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('freezes while disconnected and catches up from the original start on reconnect', () => {
    const view = statusHarness(1_000)
    view.set(1_000, true)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(view.getByRole('timer').textContent).toBe('0:04')
    view.set(1_000)
    expect(view.getByRole('timer').textContent).toBe('0:09')
  })

  it('resets to a new Turn and clamps starts ahead of the client clock', () => {
    const view = statusHarness(1_000)
    view.set(6_000)
    expect(view.getByRole('timer').textContent).toBe('0:00')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.getByRole('timer').textContent).toBe('0:02')
    expect(vi.getTimerCount()).toBe(1)
  })

  it.each([[967_000, '16:07'], [3_723_000, '1:02:03'], [60_000, '1:00']])(
    'formats a recorded %i millisecond duration as %s', (elapsed, text) => {
      const view = render(<RunningStatus startTime={1_000} endTime={1_000 + elapsed} paused={true} t={t} />)
      expect(view.getByRole('timer').textContent).toBe(text)
      expect(vi.getTimerCount()).toBe(0)
    },
  )
})

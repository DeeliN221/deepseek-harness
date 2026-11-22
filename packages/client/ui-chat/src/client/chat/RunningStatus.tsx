/** The latest Turn clock, isolated from the transcript's render cycle. */
import { memo, useEffect, useState } from 'react'
import { IconClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatFlowDataInjected, ChatViewSlotProps, PerformanceUsageInjected } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { UsagePill } from './StatsPills.tsx'
import css from './StatsPills.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  readonly endTime?: number | undefined
  readonly paused: boolean
  readonly stopRequestedAt?: number | undefined
  readonly t: ChatViewSlotProps['t']
}

/**
 * Show a digital Turn duration without announcing every tick.
 * @param props - Recorded Turn times and current connection or stop state.
 * @returns a named, non-live timer, or nothing before a Turn start is known.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, endTime, paused, stopRequestedAt, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined || endTime !== undefined || paused || stopRequestedAt !== undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime, endTime, paused, stopRequestedAt])
  if (startTime === undefined) return null
  const elapsed = Math.max(0, (stopRequestedAt ?? endTime ?? now) - startTime)
  const parts = formatRunDuration(elapsed, t)
  const numbers = parts.filter(part => part.numeric).map(part => part.text)
  const digital = (numbers.length === 1 ? ['0', ...numbers] : numbers)
    .map((value, index) => index === 0 ? value : value.padStart(2, '0')).join(':')
  const label = t('stats.elapsed', { duration: parts.map(part => part.text).join('') })
  return (
    <span className={css.anchor} data-composer-stat="elapsed" role="timer" aria-live="off" aria-label={label}>
      <span className={css.pill} aria-hidden="true">
        <IconClockOutlineRegular />
        <span className={css.label}>{digital}</span>
      </span>
    </span>
  )
})

/** Session-bound inputs to the elapsed reading in the existing composer dock. */
export type ElapsedPillProps = PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'chat'>
  & InjectFace<PerformanceUsageInjected & { hooks: Pick<ChatFlowDataInjected['hooks'], 'connectionState'> }>

/** Render the latest recorded Turn, retaining its final duration after completion. */
export const ElapsedPill = memo(function ElapsedPill({
  useSession, useChat, useProjection, usePerformanceUsage, useConnectionState, t,
}: ElapsedPillProps) {
  const mode = usePerformanceUsage(value => value)
  const running = useSession(snapshot => snapshot.running)
  const stopRequestedAt = useSession(snapshot => snapshot.stopping?.requestedAt)
  const disconnected = useConnectionState(state => state === 'disconnected' || state === 'connecting')
  const turn = useChat((snapshot) => {
    const latest = snapshot.timeline.turnOrder.at(-1)
    return latest === undefined ? undefined : snapshot.timeline.turns.get(latest)
  })
  // A running bit can arrive before the next Turn; never time the previous closed Turn as the new run.
  const startTime = running && turn?.status !== 'open' ? undefined : turn?.start?.time
  return <>
    <RunningStatus key={turn?.turn} startTime={startTime} endTime={turn?.end?.time}
      paused={disconnected || !running} stopRequestedAt={stopRequestedAt} t={t} />
    {mode === 'detailed' && <UsagePill useChat={useChat} useProjection={useProjection}
      usePerformanceUsage={usePerformanceUsage} t={t} />}
  </>
})

/** Session-owned Agent Teams switch inside the model menu. */

import { useId, useRef, useState } from 'react'
import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-agent-team/client'
import type {} from '@deepseek-ai/dsh-agent'
import type { NS } from './locales.ts'
import css from './TeamModeToggle.module.css'

/** Session selection callbacks supplied to the Team switch. */
export interface TeamModeInjected {
  /** Save the selection; null means success, otherwise the string describes the failure. */
  selectTeamMode: (enabled: boolean) => Promise<string | null>
  /** Open a Session-targeted confirmation outside this menu. */
  requestDisableConfirmation: () => void
}

/** Full props of the model-menu Team switch. */
export type TeamModeToggleProps = PropsRuntime<'conversation.input.model.options'>
  & PropsLocale<typeof NS> & TeamModeInjected

/** Change the saved Team state directly, only on a root Session. */
export function TeamModeToggle(props: TeamModeToggleProps) {
  const addressedChild = props.useSession(snapshot => snapshot.subagent !== null)
  const listedChild = props.useSessions(state => state.byId[props.sessionId]?.origin === 'subagent')
  if (addressedChild || listedChild) return null
  return <RootTeamModeToggle {...props} />
}

function RootTeamModeToggle({
  useProjection, locked, dismiss, reportFailure, selectTeamMode, requestDisableConfirmation, t,
}: TeamModeToggleProps) {
  const mode = useProjection('agentTeam')
  const modelSelection = useProjection('modelSelection')
  const [pending, setPending] = useState(false)
  const writing = useRef(false)
  const descriptionId = useId()
  if (mode === undefined) return null
  const disabled = locked || pending || modelSelection === undefined
  const select = (enabled: boolean): void => {
    if (disabled || writing.current) return
    if (!enabled && modelSelection !== undefined && modelSelection.lastUsed !== null) {
      dismiss()
      requestDisableConfirmation()
      return
    }
    writing.current = true
    setPending(true)
    void selectTeamMode(enabled).then((failure) => {
      if (failure !== null) reportFailure(t('mode.failed', { message: failure }))
    }, (error: unknown) => {
      reportFailure(t('mode.failed', { message: error instanceof Error ? error.message : String(error) }))
    }).finally(() => { writing.current = false; setPending(false) })
  }
  return (
    <Tooltip label={t('mode.description')} side="top" portal delayMs={500} focusDelayMs={500}>
      <div className={css.row} aria-busy={pending}>
        <span className={css.label}>{t('command.title')}</span>
        <Switch className={css.toggle} checked={mode.enabled} disabled={disabled}
          label={t('command.title')} onChange={select} describedBy={descriptionId} />
        <span id={descriptionId} className={css.description}>{t('mode.description')}</span>
      </div>
    </Tooltip>
  )
}

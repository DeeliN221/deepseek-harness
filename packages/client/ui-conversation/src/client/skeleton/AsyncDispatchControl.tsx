/** Session dispatch preference contributed to the existing model menu. */
import { useId, useRef, useState } from 'react'
import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/model-menu.ts'
import type {} from '../../dispatch-types.ts'
import css from './AsyncDispatchControl.module.css'

/** The existing session-addressed write preserves workspace defaults and next-message admission. */
export interface AsyncDispatchInjected {
  save: (enabled: boolean) => Promise<string | null>
}

/** The direct menu switch uses the projected value, never an optimistic copy of the preference. */
export function AsyncDispatchControl({ useSession, useProjection, useAccess, locked, reportFailure, t, save }:
  PropsRuntime<'conversation.input.model.options'> & PropsLocale<'conversation'> & AsyncDispatchInjected) {
  const checked = useProjection('asyncDispatch') === true
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  const denied = useAccess('session/prompt') === false
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const descriptionId = useId()
  if (subagent !== null) return null
  const disabled = locked || removed || denied || saving
  const change = async () => {
    if (disabled || pending.current) return
    pending.current = true
    setSaving(true)
    try {
      const error = await save(!checked)
      if (error !== null) reportFailure(error)
    } catch (failure) {
      reportFailure(`${t('dispatch.failed')}: ${String(failure)}`)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <Tooltip label={t('dispatch.hint')} side="top" portal delayMs={500} focusDelayMs={500}>
      <div className={css.control} aria-busy={saving}>
        <span className={css.label}>{t('dispatch.label')}</span>
        <Switch className={css.toggle} checked={checked} disabled={disabled}
          label={t('dispatch.label')} describedBy={descriptionId} onChange={() => { void change() }} />
        <span id={descriptionId} className={css.description}>{t('dispatch.hint')}</span>
      </div>
    </Tooltip>
  )
}

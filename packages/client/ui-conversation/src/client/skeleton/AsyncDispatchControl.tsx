/** Compact, controlled dispatch preference; persistence errors stay beside the control. */
import { useState } from 'react'
import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AsyncDispatchControl.module.css'

/** @param props - projected value, localized copy and the Session-addressed write. @returns the toolbar switch. */
export function AsyncDispatchControl({ checked, disabled, label, description, failureLabel, save }: {
  checked: boolean
  disabled: boolean
  label: string
  description: string
  failureLabel: string
  save: (enabled: boolean) => Promise<string | null>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = async (enabled: boolean) => {
    setSaving(true)
    setError(null)
    try { setError(await save(enabled)) }
    catch (failure) { setError(`${failureLabel}: ${String(failure)}`) }
    finally { setSaving(false) }
  }
  return (
    <div className={css.root}>
      <Tooltip label={description} side="top" portal>
        <span className={css.control}>
          <span>{label}</span>
          <Switch checked={checked} disabled={disabled || saving} label={label}
            onChange={(enabled) => { void change(enabled) }} />
        </span>
      </Tooltip>
      {error === null ? null : <span className={css.error} role="alert">{error}</span>}
    </div>
  )
}

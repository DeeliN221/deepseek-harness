import { useCallback, useEffect, useRef } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { OwnerFileText, WorkspaceFileSaveRequest, WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TextPreviewProps } from './TextPreview.tsx'
import type { TextEditState } from './store.ts'

/** Source editing uses owner endpoints, never the preview's paged reads. */
export interface TextEditInjected {
  readonly readEdit: (path: string, signal: AbortSignal) => Promise<RemoteResult<OwnerFileText>>
  readonly saveEdit: (path: string, value: WorkspaceFileSaveRequest, signal: AbortSignal) => Promise<RemoteResult<WorkspaceFileStat>>
}

/** Preserve untouched source bytes when the textarea normalizes CRLF/CR to LF. */
export function sourceText(value: string, previous: string): string {
  const normalized = previous.replace(/\r\n|\r/g, '\n')
  const next = value.replace(/\r\n|\r/g, '\n')
  if (normalized === next) return previous
  let prefix = 0
  while (prefix < normalized.length && prefix < next.length && normalized[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < normalized.length - prefix && suffix < next.length - prefix
    && normalized[normalized.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  // Map normalized boundaries back to the original, preserving mixed endings outside the edit.
  const offsets = [0]
  for (let index = 0; index < previous.length; index++) {
    if (previous[index] === '\r' && previous[index + 1] === '\n') index++
    offsets.push(index + 1)
  }
  const newline = previous.match(/\r\n|\r|\n/)?.[0] ?? '\n'
  return previous.slice(0, offsets[prefix])
    + next.slice(prefix, next.length - suffix).replace(/\n/g, newline)
    + previous.slice(offsets[normalized.length - suffix])
}

/** Tab-owned edit operations. The store and leave guard outlive a mounted body. */
export function useTextEdit({ edit, tab, actions, readEdit, saveEdit, t }: {
  edit: TextEditState | undefined
  tab: ReturnType<TextPreviewProps['useTabInfo']>['tab']
  actions: TextPreviewProps['actions']
  readEdit: TextEditInjected['readEdit']
  saveEdit: TextEditInjected['saveEdit']
  t: TextPreviewProps['t']
}) {
  const latest = useRef(edit)
  latest.current = edit
  const set = useCallback((next: TextEditState | undefined): void => {
    if (tab.signal.aborted) return
    latest.current = next
    actions.edited(tab.id, next)
  }, [actions, tab.id, tab.signal])
  const dirty = useCallback((): boolean => {
    const value = latest.current
    return value !== undefined && value.text !== value.original
  }, [])
  const editing = edit !== undefined
  const unsaved = edit !== undefined && (edit.text !== edit.original || edit.busy === 'saving')
  useEffect(() => {
    // Deliberately tied to the record, not this mount: inactive drafts still guard close and refresh.
    if (!editing) {
      tab.actions.setLeaveGuard(undefined)
      return
    }
    tab.actions.setLeaveGuard({
      hasUnsavedChanges: () => dirty() || latest.current?.busy === 'saving',
      beforeLeave: reason => {
        if (latest.current?.busy !== undefined) return false
        return !dirty() || window.confirm(t(reason === 'close' ? 'edit.discardConfirm' : 'edit.leaveConfirm'))
      },
    })
  }, [tab.actions, t, editing, dirty, unsaved])
  const discard = useCallback((): boolean => {
    if (latest.current?.busy !== undefined) return false
    if (dirty() && !window.confirm(t('edit.discardConfirm'))) return false
    set(undefined)
    return true
  }, [dirty, set, t])
  const start = useCallback(async (path: string): Promise<void> => {
    if (tab.signal.aborted || latest.current?.busy !== undefined) return
    const pending: TextEditState = { path, text: '', original: '', version: '', busy: 'reading', failure: undefined }
    set(pending)
    const result = await readEdit(path, tab.signal)
    if (tab.signal.aborted) return
    if (result.ok) set({ path: result.value.absolutePath, text: result.value.text, original: result.value.text,
      version: result.value.version, busy: undefined, failure: undefined })
    else set({ ...pending, busy: undefined, failure: result.error })
  }, [readEdit, tab.signal, set])
  const save = useCallback(async (): Promise<void> => {
    const value = latest.current
    if (value === undefined || value.busy !== undefined || value.version === '' || !dirty()) return
    const pending: TextEditState = { ...value, busy: 'saving', failure: undefined }
    set(pending)
    const result = await saveEdit(value.path, { text: value.text, version: value.version }, tab.signal)
    if (tab.signal.aborted) return
    if (result.ok) {
      set({ ...value, original: value.text, version: result.value.version, busy: undefined, failure: undefined })
      // Preview is reloaded on return; source editing stays open after an explicit save.
      actions.reset(tab.id)
    } else set({ ...value, busy: undefined, failure: result.error })
  }, [saveEdit, tab.signal, tab.id, set, dirty, actions])
  return {
    dirty: edit !== undefined && edit.text !== edit.original,
    start, save, discard,
    change: (text: string): void => {
      const value = latest.current
      if (value !== undefined && value.busy === undefined) set({ ...value, text: sourceText(text, value.text) })
    },
  }
}

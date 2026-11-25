// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { TextPreview } from '../src/client/TextPreview.tsx'
import type { TextPreviewProps } from '../src/client/TextPreview.tsx'
import { sourceText } from '../src/client/edit.ts'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { ABSOLUTE_PATH, TAB_ID, harness, page } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function editorHarness(text = '\uFEFFfirst\r\nsecond\r\n') {
  const h = harness()
  h.script(1, page(1, ['preview only'], true))
  const props = h.props()
  const readEdit = vi.fn<TextPreviewProps['readEdit']>().mockResolvedValue({ ok: true,
    value: { absolutePath: ABSOLUTE_PATH, version: 'edit-v1', text } })
  const saveEdit = vi.fn<TextPreviewProps['saveEdit']>().mockResolvedValue({ ok: true,
    value: { absolutePath: ABSOLUTE_PATH, version: 'edit-v2' } })
  return { ...h, props: { ...props, readEdit, saveEdit }, readEdit, saveEdit }
}

async function enter(h: ReturnType<typeof editorHarness>) {
  const view = render(<TextPreview {...h.props} />)
  fireEvent.click(await view.findByRole('button', { name: 'edit.start' }))
  const input = await view.findByRole('textbox', { name: 'edit.label' })
  await waitFor(() => { expect(input.hasAttribute('readonly')).toBe(false) })
  return { view, input }
}

describe('explicit source editing', () => {
  it('reads complete source, preserves BOM and CRLF, and writes only on Save with its base version', async () => {
    const h = editorHarness()
    const { view, input } = await enter(h)
    expect(h.readEdit).toHaveBeenCalledWith(ABSOLUTE_PATH, h.controller.signal)
    expect((input as HTMLTextAreaElement).value).toBe('\uFEFFfirst\nsecond\n')
    fireEvent.change(input, { target: { value: '\uFEFFchanged\nsecond\n' } })
    expect(h.saveEdit).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'edit.save' }))
    await waitFor(() => { expect(h.saveEdit).toHaveBeenCalledWith(ABSOLUTE_PATH,
      { text: '\uFEFFchanged\r\nsecond\r\n', version: 'edit-v1' }, h.controller.signal) })
    await waitFor(() => { expect(h.instance.getSnapshot().byTab[TAB_ID]?.edit?.version).toBe('edit-v2') })
    expect((view.getByRole('button', { name: 'edit.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('retains a dirty draft after external changes and a conflict, and confirms before reload', async () => {
    const h = editorHarness('original\n')
    h.saveEdit.mockResolvedValue({ ok: false, error: new RemoteError('workspace-file/conflict', 'changed', { path: ABSOLUTE_PATH }) })
    const { view, input } = await enter(h)
    fireEvent.change(input, { target: { value: 'draft\n' } })
    act(() => { h.setVersion('external') })
    expect((input as HTMLTextAreaElement).value).toBe('draft\n')
    fireEvent.click(view.getByRole('button', { name: 'edit.save' }))
    await view.findByRole('alert')
    expect((input as HTMLTextAreaElement).value).toBe('draft\n')
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.edit?.version).toBe('edit-v1')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(view.getByRole('button', { name: 'reloadNow' }))
    expect(confirm).toHaveBeenCalledWith('edit.discardConfirm')
    expect(h.readEdit).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    h.readEdit.mockResolvedValue({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'external', text: 'external\n' } })
    fireEvent.click(view.getByRole('button', { name: 'reloadNow' }))
    await waitFor(() => { expect((input as HTMLTextAreaElement).value).toBe('external\n') })
    expect(h.saveEdit).toHaveBeenCalledTimes(1)
  })

  it('preserves drafts across remount and refuses cancelling without confirmation', async () => {
    const h = editorHarness('original')
    const { view, input } = await enter(h)
    fireEvent.change(input, { target: { value: 'draft' } })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(view.getByRole('button', { name: 'edit.cancel' }))
    expect((input as HTMLTextAreaElement).value).toBe('draft')
    view.unmount()
    const restored = render(<TextPreview {...h.props} />)
    expect((restored.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft')
    expect(h.readEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps failed reads read-only and prevents saving an unknown binary source', async () => {
    const h = editorHarness()
    h.readEdit.mockResolvedValue({ ok: false, error: new RemoteError('workspace-file/not-text', 'binary', { path: ABSOLUTE_PATH }) })
    const view = render(<TextPreview {...h.props} />)
    fireEvent.click(await view.findByRole('button', { name: 'edit.start' }))
    await view.findByRole('alert')
    expect(view.getByRole('textbox').hasAttribute('readonly')).toBe(true)
    expect((view.getByRole('button', { name: 'edit.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(h.saveEdit).not.toHaveBeenCalled()
  })

  it('blocks repeated saves and leave while the explicit save is pending', async () => {
    const h = editorHarness('old')
    const pending = Promise.withResolvers<Awaited<ReturnType<TextPreviewProps['saveEdit']>>>()
    h.saveEdit.mockReturnValue(pending.promise)
    const { view, input } = await enter(h)
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.click(view.getByRole('button', { name: 'edit.save' }))
    expect((view.getByRole('button', { name: 'edit.saving' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: 'edit.cancel' }) as HTMLButtonElement).disabled).toBe(true)
    const bind = vi.mocked(h.props.useTabInfo().tab.actions.setLeaveGuard)
    const guard = bind.mock.calls.at(-1)?.[0]
    expect(guard?.beforeLeave('close')).toBe(false)
    expect(guard?.hasUnsavedChanges()).toBe(true)
    await act(async () => { pending.resolve({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v2' } }) })
    expect(h.saveEdit).toHaveBeenCalledTimes(1)
  })
})

it('preserves untouched mixed newline endings, trailing newline, and Unicode', () => {
  expect(sourceText('a\nb edit\nc\n', 'a\r\nb\nc\r')).toBe('a\r\nb edit\nc\r')
  expect(sourceText('a\n\n', 'a\r\n')).toBe('a\r\n\r\n')
  expect(sourceText('中文🙂', '中文')).toBe('中文🙂')
  expect(sourceText('', '\uFEFFa\r\n')).toBe('')
})

// @vitest-environment jsdom
/** Owner directory navigation retains the existing sidebar and Session file addressing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { mountBody, PANE, ROOT, SESSION } from './mount.client.tsx'
import { answer, searchesSettled } from './search-fixture.client.ts'
import { zh } from '../src/client/locales.ts'
import type { DirLevel } from '../src/client/store.ts'

const level = (absolutePath: string, parentPath: string): DirLevel => ({
  absolutePath, parentPath, entries: [{ name: 'note.txt', type: 'file', size: 4 }], truncated: false,
})
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})
async function mounted() {
  const h = mountBody()
  await act(() => h.script.watches.ready(ROOT))
  await act(() => h.script.settle({ ok: true, value: level(ROOT, '/work') }))
  return h
}
function submit(h: Awaited<ReturnType<typeof mounted>>, path: string) {
  const input = h.view.getByRole('textbox', { name: zh['path.label'] })
  fireEvent.change(input, { target: { value: path } })
  fireEvent.submit(input.closest('form')!)
}
describe('owner directory navigation', () => {
  it('opens the Host parent and keeps external file addresses absolute', async () => {
    const h = await mounted()
    fireEvent.click(h.view.getByRole('button', { name: zh['path.parent'] }))
    expect(h.script.outstanding()).toEqual(['/work'])
    expect(h.view.container.querySelector('[data-files-root]')?.getAttribute('data-files-root')).toBe(ROOT)
    await act(() => h.script.settle({ ok: true, value: level('/work', '/') }))
    await act(() => h.script.watches.ready('/work'))
    await act(() => h.script.settle({ ok: true, value: level('/work', '/') }))
    expect(h.view.getByRole('textbox', { name: zh['path.label'] }).getAttribute('value')).toBe('/work')
    fireEvent.click(h.view.getByRole('button', { name: 'note.txt' }))
    expect(h.tabActions.openResource).toHaveBeenCalledWith(sessionFileAddress(SESSION, '/work/note.txt'), { paneId: PANE })
  })
  it('accepts canonical absolute directories and disables parent at the filesystem root', async () => {
    const h = await mounted()
    submit(h, '/tmp/../')
    await act(() => h.script.settle({ ok: true, value: level('/', '/') }))
    await act(() => h.script.watches.ready('/'))
    await act(() => h.script.settle({ ok: true, value: level('/', '/') }))
    expect(h.view.getByRole('button', { name: zh['path.parent'] }).hasAttribute('disabled')).toBe(true)
    expect(h.view.container.querySelector('[data-files-root]')?.getAttribute('data-files-root')).toBe('/')
  })
  it('keeps the current tree and reports a refused directory', async () => {
    const h = await mounted()
    submit(h, '/missing')
    await act(() => h.script.settle({ ok: false, error: new RemoteError('workspace-file/not-found', 'missing directory', { path: '/missing' }) }))
    expect(h.view.getByRole('alert').textContent).toBe(zh['error.notFound'])
    expect(h.view.container.querySelector('[data-files-root]')?.getAttribute('data-files-root')).toBe(ROOT)
    expect(h.view.getByRole('button', { name: 'note.txt' })).toBeTruthy()
  })
  it.each(['/tmp', '/work'])('keeps workspace search results and file identity after browsing %s', async (directory) => {
    const h = await mounted()
    submit(h, directory)
    await act(() => h.script.settle({ ok: true, value: level(directory, '/') }))
    await act(() => h.script.watches.ready(directory))
    await act(() => h.script.settle({ ok: true, value: level(directory, '/') }))
    h.searches.answerWith(answer(['note.txt', 'src/report.txt']))
    await act(async () => {
      h.face.setQuery(PANE, ROOT, 'txt')
      await searchesSettled()
    })
    const results = h.view.container.querySelector('[data-files-view="search"]')!
    expect([...results.querySelectorAll('[data-files-entry]')].map(row => row.getAttribute('data-files-path')))
      .toEqual([`${ROOT}/src`, `${ROOT}/src/report.txt`, `${ROOT}/note.txt`])
    fireEvent.click(h.view.getByRole('button', { name: 'report.txt' }))
    expect(h.tabActions.openResource).toHaveBeenCalledWith(sessionFileAddress(SESSION, 'src/report.txt'), { paneId: PANE })

    // The browsed directory contains a same-named file, but it is not the search match.
    h.placement.contentId = sessionFileAddress(SESSION, `${directory}/note.txt`)
    h.rerender()
    expect(results.querySelector('[aria-current]')).toBeNull()
    h.placement.contentId = sessionFileAddress(SESSION, 'note.txt')
    h.rerender()
    expect(results.querySelector('[aria-current]')?.closest('[data-files-entry]')?.getAttribute('data-files-path'))
      .toBe(`${ROOT}/note.txt`)
  })
  it('ignores an older navigation after a newer request is accepted', async () => {
    const h = await mounted()
    act(() => { h.face.navigate(PANE, '/old'); h.face.navigate(PANE, '/new') })
    await act(() => h.script.settleLatest({ ok: true, value: level('/new', '/') }))
    await act(() => h.script.settle({ ok: true, value: level('/old', '/') }))
    expect(h.instance.getSnapshot().byPane[PANE]?.directory).toBe('/new')
  })
})

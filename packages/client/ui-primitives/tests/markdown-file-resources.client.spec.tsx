// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownDelegateProvider } from '../src/index.ts'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

type Status = 'none' | 'loading' | 'live' | 'failed'

function resourceFixture(initial: Status = 'loading') {
  let status = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const snapshot = () => status
  const address = vi.fn((path: string) => `session/one/${path}`)
  const useResource = vi.fn((_address: string) => ({ status: useSyncExternalStore(subscribe, snapshot) }))
  return {
    delegate: { address, useResource },
    set(next: Status) { act(() => { status = next; listeners.forEach(listener => { listener() }) }) },
  }
}

describe('Markdown live file resources', () => {
  it.each([
    ['See src/a.ts:24.', 'src/a.ts:24', 'src/a.ts', 24],
    ['（src/a.ts#L3-L7）', 'src/a.ts#L3-L7', 'src/a.ts', 3],
    ['`src/a.ts:5:2`', 'src/a.ts:5:2', 'src/a.ts', 5],
    ['`/tmp/My Notes.md#L4`', '/tmp/My Notes.md#L4', '/tmp/My Notes.md', 4],
    ['[source](<docs/My Notes.md:8>)', 'source', 'docs/My Notes.md', 8],
    ['[source](file:///tmp/a.ts#L9)', 'source', '/tmp/a.ts', 9],
    ['`C:\\work\\a.ts:6`', 'C:\\work\\a.ts:6', 'C:\\work\\a.ts', 6],
    ['`index.ts:2`', 'index.ts:2', 'index.ts', 2],
    ['.env:2', '.env:2', '.env', 2],
  ] as const)('checks the decoded path and preserves the line in %s', (text, label, path, line) => {
    const resource = resourceFixture()
    const openFile = vi.fn()
    const external = vi.fn()
    const view = render(<MarkdownDelegateProvider openFile={openFile} openExternalLink={external}
      fileResources={resource.delegate}><MarkdownText text={text} /></MarkdownDelegateProvider>)
    expect(view.queryByRole('button')).toBeNull()
    expect(resource.delegate.address).toHaveBeenCalledWith(path)
    for (const status of ['none', 'failed'] as const) {
      resource.set(status)
      expect(view.queryByRole('button')).toBeNull()
    }
    resource.set('live')
    const button = view.getByRole('button', { name: label })
    expect(button.tabIndex).toBe(0)
    act(() => { button.focus() })
    expect(document.activeElement).toBe(button)
    // Verify native Enter/Space activation in an assembled browser, not jsdom.
    fireEvent.click(button, { ctrlKey: true })
    expect(openFile).toHaveBeenCalledExactlyOnceWith(path, { line })
    expect(external).not.toHaveBeenCalled()
    expect(view.container.querySelector('a')).toBeNull()
    resource.set('failed')
    expect(view.queryByRole('button')).toBeNull()
    expect(view.container.textContent).toContain(label)
  })

  it('does not inspect incomplete streamed paths or nest controls in link labels', () => {
    const resource = resourceFixture('live')
    const openFile = vi.fn()
    const text = 'src/a.ts `src/b.ts` [see `src/c.ts`](src/d.ts) [web](https://example.com)'
    const content = (streaming: boolean) => <MarkdownDelegateProvider openFile={openFile}
      fileResources={resource.delegate}><MarkdownText text={text} streaming={streaming} /></MarkdownDelegateProvider>
    const view = render(content(true))
    expect(resource.delegate.useResource).not.toHaveBeenCalled()
    expect(view.queryByRole('button')).toBeNull()
    view.rerender(content(false))
    expect(view.getAllByRole('button')).toHaveLength(3)
    expect(resource.delegate.address).not.toHaveBeenCalledWith('src/c.ts')
    expect(view.container.querySelector('button button, a button')).toBeNull()
    expect(view.getByRole('link', { name: 'web' }).getAttribute('href')).toBe('https://example.com')
  })

  it('gates old vocabulary mentions on current metadata rather than an earlier file change', () => {
    const resource = resourceFixture('failed')
    const staleOpen = vi.fn()
    const view = render(<MarkdownDelegateProvider openFile={vi.fn()} fileResources={resource.delegate}>
      <MarkdownText text="`src/deleted.ts`" fileMentions={{ resolve: () => ({
        open: staleOpen, label: 'old', title: 'src/deleted.ts',
      }) }} />
    </MarkdownDelegateProvider>)
    expect(view.queryByRole('button')).toBeNull()
    expect(staleOpen).not.toHaveBeenCalled()
  })

  it('checks canonical vocabulary aliases and opens them through the scoped delegate', () => {
    const resource = resourceFixture('live')
    const staleOpen = vi.fn()
    const openFile = vi.fn()
    const view = render(<MarkdownDelegateProvider openFile={openFile} fileResources={resource.delegate}>
      <MarkdownText text="`report`" fileMentions={{ resolve: () => ({
        open: staleOpen, label: 'report', title: '/workspace/output/report#1.md',
      }) }} />
    </MarkdownDelegateProvider>)
    expect(resource.delegate.address).toHaveBeenCalledWith('/workspace/output/report#1.md')
    fireEvent.click(view.getByRole('button', { name: 'report' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('/workspace/output/report#1.md', undefined)
    expect(staleOpen).not.toHaveBeenCalled()
  })

  it('rebinds cached paths to the new owner scope', () => {
    const first = resourceFixture('live')
    const second = resourceFixture('failed')
    const markdown = <MarkdownText text="[source](src/a.ts#L4)" />
    const content = (resources: typeof first.delegate) => <MarkdownDelegateProvider openFile={vi.fn()}
      fileResources={resources}>{markdown}</MarkdownDelegateProvider>
    const view = render(content(first.delegate))
    expect(view.queryByRole('button')).not.toBeNull()
    view.rerender(content(second.delegate))
    expect(view.queryByRole('button')).toBeNull()
    second.set('live')
    expect(view.queryByRole('button')).not.toBeNull()
  })
})

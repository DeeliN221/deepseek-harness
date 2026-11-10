// @vitest-environment jsdom
/** General Settings row that chooses and orders the Conversation View tabs kept in the header. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ViewTab } from '../src/client/contract/views.ts'
import type { ViewTabSelection } from '../src/submission-settings.ts'
import { ViewTabsRow } from '../src/client/settings/ViewTabsRow.tsx'
import type { ViewTabsRowProps } from '../src/client/settings/ViewTabsRow.tsx'
import { en } from '../src/client/locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(() => { cleanup() })

const VIEWS: readonly ViewTab[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'trajectory', label: 'Trajectory' },
  { id: 'context', label: 'Context' },
  { id: 'fleet', label: 'Fleet' },
]

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

function mount(selection: ViewTabSelection) {
  const store = createSnapshotStore<ViewTabSelection>(selection)
  const setViewTabs = vi.fn<(ids: readonly string[]) => void>((ids) => { store.set(ids) })
  const props: ViewTabsRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noPendingInteraction(),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    useViewTabs: bindSnapshotSelector(store),
    useConversationViews: selector => selector(VIEWS),
    setViewTabs,
    t: makeTranslate(en),
  }
  render(<ViewTabsRow {...props} />)
  return { store, setViewTabs }
}

describe('ViewTabsRow', () => {
  it('explains the scope and lists the fixed Chat plus every configurable View', () => {
    mount(['fleet', 'trajectory'])
    expect(screen.getByText('Header session tabs')).toBeDefined()
    expect(screen.getByText(/Choose which View tabs/)).toBeDefined()
    expect(screen.getByText('Fixed')).toBeDefined()
    expect(screen.getByRole('list', { name: 'Header session tabs' })).toBeDefined()
    const labels = screen.getAllByRole('listitem').map(item => item.textContent)
    expect(labels).toEqual(['ChatFixed', 'Fleet', 'Trajectory', 'Context'])
  })

  it('checks the ordered selection and keeps every other View unchecked at the end', () => {
    mount(['fleet', 'trajectory'])
    expect(screen.getByRole('button', { name: 'Hide Fleet' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Hide Trajectory' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show Context' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adds a hidden View at the end and removes a shown View', () => {
    const b = mount(['fleet', 'trajectory'])
    fireEvent.click(screen.getByRole('button', { name: 'Show Context' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['fleet', 'trajectory', 'context'])
    fireEvent.click(screen.getByRole('button', { name: 'Hide Fleet' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['trajectory', 'context'])
  })

  it('reorders within the selection and disables the edge moves', () => {
    const b = mount(['fleet', 'trajectory', 'context'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Trajectory up' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['trajectory', 'fleet', 'context'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Trajectory down' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['fleet', 'trajectory', 'context'])
    expect((screen.getByRole('button', { name: 'Move Fleet up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Context down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('treats the automatic layout as every View checked in registration order', () => {
    const b = mount(null)
    expect(screen.getByRole('button', { name: 'Hide Trajectory' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Context' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['trajectory', 'fleet'])
  })
})

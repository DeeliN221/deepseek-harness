// @vitest-environment jsdom
/** General Settings row that orders the Conversation View tabs in the Session header. */
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
  it('explains the order scope and lists the fixed Chat plus every configurable View', () => {
    mount(['fleet', 'trajectory'])
    expect(screen.getByText('Header tab order')).toBeDefined()
    expect(screen.getByText(/Choose the order of the header tabs/)).toBeDefined()
    expect(screen.getByText('Fixed')).toBeDefined()
    expect(screen.getByRole('list', { name: 'Header tab order' })).toBeDefined()
    const labels = screen.getAllByRole('listitem').map(item => item.textContent)
    expect(labels).toEqual(['ChatFixed', 'Fleet', 'Trajectory', 'Context'])
  })

  it('keeps every View in the list and exposes no visibility toggle', () => {
    mount(['fleet', 'trajectory'])
    expect(screen.queryByRole('button', { name: /Show |Hide / })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('reorders the configured Views and disables the edge moves', () => {
    const b = mount(['fleet', 'trajectory', 'context'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Trajectory up' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['trajectory', 'fleet', 'context'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Trajectory down' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['fleet', 'trajectory', 'context'])
    expect((screen.getByRole('button', { name: 'Move Fleet up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Context down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('orders unlisted Views by registration order and persists an explicit order on the first move', () => {
    const b = mount(null)
    expect(screen.getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['ChatFixed', 'Trajectory', 'Context', 'Fleet'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Fleet up' }))
    expect(b.setViewTabs).toHaveBeenLastCalledWith(['trajectory', 'fleet', 'context'])
  })
})

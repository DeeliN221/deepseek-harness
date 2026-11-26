import { describe, expect, it, vi } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  MAGPIE_ROUTING_PROVIDER, MERGED_GROUP_ID, groupModelsForDisplay,
} from '../src/client/model-groups.ts'
import { orderModelProviders } from '../src/client/provider-order.ts'
import { movePersistedDraft } from '../src/client/draft-transfer.ts'

const group = (id: string, name: string, models: readonly { id: string; name: string }[]): ModelProviderGroup => ({
  id, name, models,
})

describe('model family folding', () => {
  it('folds one exact model id across providers into one row routed to the first provider', () => {
    const sections = groupModelsForDisplay([
      group('trusted', 'Trusted', [{ id: 'same', name: 'Same model' }]),
      group('external', 'External', [{ id: 'same', name: 'Same model' }]),
    ], null)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.id).toBe(MERGED_GROUP_ID)
    expect(sections[0]!.models.map(model => model.id)).toEqual(['same'])
    expect(sections[0]!.routeOf('same')).toBe('trusted')
    expect(sections[0]!.entryOf('same', 'external')?.name).toBe('Same model')
  })

  it('never merges different versions that a version-stripping key would collide', () => {
    const sections = groupModelsForDisplay([
      group('opencode-go', 'opencode', [
        { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'opencode-go/deepseek-v3.2-flash', name: 'DeepSeek V3.2 Flash' },
      ]),
    ], null)
    expect(sections[0]!.models.map(model => model.id))
      .toEqual(['opencode-go/deepseek-v4.1-flash', 'opencode-go/deepseek-v3.2-flash'])
  })

  it('keeps a Magpie routing entry as its own selectable failover route', () => {
    const sections = groupModelsForDisplay([
      group(MAGPIE_ROUTING_PROVIDER, 'Magpie (Routing)', [
        { id: 'auto/gpt-6-luna', name: '[路由组] GPT-6 Luna' },
      ]),
      group('codex', 'Codex', [
        { id: 'codex/gpt-6-luna', name: '[Codex] GPT-6 Luna' },
      ]),
    ], null)
    expect(sections[0]!.models.map(model => model.id))
      .toEqual(['auto/gpt-6-luna', 'codex/gpt-6-luna'])
    expect(sections[0]!.routeOf('auto/gpt-6-luna')).toBe(MAGPIE_ROUTING_PROVIDER)
    expect(sections[0]!.routeOf('codex/gpt-6-luna')).toBe('codex')
  })

  it('keeps the Session existing route instead of moving it to the display-first provider', () => {
    const sections = groupModelsForDisplay([
      group('trusted', 'Trusted', [{ id: 'same', name: 'Same model' }]),
      group('external', 'External', [{ id: 'same', name: 'Same model' }]),
    ], { provider: 'external', model: 'same' })
    expect(sections[0]!.models.map(model => model.id)).toEqual(['same'])
    expect(sections[0]!.routeOf('same')).toBe('external')
  })

  it('keeps engine groups separate from the merged section', () => {
    const sections = groupModelsForDisplay([
      group('trusted', 'Trusted', [{ id: 'same', name: 'Same model' }]),
      group('acp:agy', 'ACP agy', [{ id: 'gemini', name: 'Gemini' }]),
    ], null)
    expect(sections.map(section => section.id)).toEqual([MERGED_GROUP_ID, 'acp:agy'])
    expect(sections[1]!.merged).toBe(false)
    expect(sections[1]!.routeOf('gemini')).toBe('acp:agy')
  })
})

describe('provider display order', () => {
  it('lists Magpie routing groups first and the personal key last without reordering the rest', () => {
    const ordered = orderModelProviders([
      { id: 'dsh-magpie-connector-deepseek-personal' },
      { id: 'dsh-magpie-connector-opencode-go' },
      { id: MAGPIE_ROUTING_PROVIDER },
      { id: 'dsh-magpie-connector-deepseek' },
    ]).map(item => item.id)
    expect(ordered).toEqual([
      MAGPIE_ROUTING_PROVIDER,
      'dsh-magpie-connector-opencode-go',
      'dsh-magpie-connector-deepseek',
      'dsh-magpie-connector-deepseek-personal',
    ])
  })
})

describe('cross-engine draft hand-off', () => {
  const storage = (): Storage => {
    const values = new Map<string, string>()
    return {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: key => values.get(key) ?? null,
      key: index => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key) },
      setItem: (key, value) => { values.set(key, String(value)) },
    }
  }

  it('copies the source draft into an empty target Session without touching the source', () => {
    const local = storage()
    vi.stubGlobal('localStorage', local)
    local.setItem('dsh.conversation.from', JSON.stringify({ draft: { text: '保留草稿', references: [{ path: 'a' }] } }))
    movePersistedDraft('from' as never, 'to' as never)
    expect(JSON.parse(local.getItem('dsh.conversation.to') ?? '{}').draft)
      .toEqual({ text: '保留草稿', references: [{ path: 'a' }] })
    expect(JSON.parse(local.getItem('dsh.conversation.from') ?? '{}').draft.text).toBe('保留草稿')
    vi.unstubAllGlobals()
  })

  it('never overwrites a target that already holds its own draft', () => {
    const local = storage()
    vi.stubGlobal('localStorage', local)
    local.setItem('dsh.conversation.from', JSON.stringify({ draft: { text: 'source' } }))
    local.setItem('dsh.conversation.to', JSON.stringify({ draft: { text: 'target own' } }))
    movePersistedDraft('from' as never, 'to' as never)
    expect(JSON.parse(local.getItem('dsh.conversation.to') ?? '{}').draft.text).toBe('target own')
    vi.unstubAllGlobals()
  })

  it('is a no-op for the same Session, an empty source, or unavailable storage', () => {
    const local = storage()
    vi.stubGlobal('localStorage', local)
    movePersistedDraft('same' as never, 'same' as never)
    movePersistedDraft('missing' as never, 'to' as never)
    expect(local.getItem('dsh.conversation.to')).toBeNull()
    local.setItem('dsh.conversation.from', JSON.stringify({ draft: { text: '   ' } }))
    movePersistedDraft('from' as never, 'to' as never)
    expect(local.getItem('dsh.conversation.to')).toBeNull()
    vi.unstubAllGlobals()
  })
})

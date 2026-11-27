import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  MAGPIE_ROUTING_PROVIDER, MERGED_GROUP_ID, groupModelsForDisplay,
} from '../src/client/model-groups.ts'
import { orderModelProviders } from '../src/client/provider-order.ts'
import { draftBlocksSwitch } from '../src/client/draft-guard.ts'

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

  it('never merges different model ids that share a display name', () => {
    const sections = groupModelsForDisplay([
      group('vendor', 'Vendor', [
        { id: 'vendor/gpt-6-luna', name: 'GPT-6 Luna' },
        { id: 'other/gpt-6-luna', name: 'GPT-6 Luna' },
      ]),
    ], null)
    expect(sections[0]!.models.map(model => model.id))
      .toEqual(['vendor/gpt-6-luna', 'other/gpt-6-luna'])
  })

  it('never merges versions whose punctuation differs (V4.1 vs V41)', () => {
    const sections = groupModelsForDisplay([
      group('vendor', 'Vendor', [
        { id: 'vendor/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'vendor/deepseek-v41-flash', name: 'DeepSeek V41 Flash' },
      ]),
    ], null)
    expect(sections[0]!.models.map(model => model.id))
      .toEqual(['vendor/deepseek-v4.1-flash', 'vendor/deepseek-v41-flash'])
  })

  it('keeps a Magpie routing entry in its own section so ids and routes never overwrite', () => {
    const sections = groupModelsForDisplay([
      group(MAGPIE_ROUTING_PROVIDER, 'Magpie (Routing)', [
        { id: 'auto/gpt-6-luna', name: '[路由组] GPT-6 Luna' },
        { id: 'shared', name: '[路由组] Shared' },
      ]),
      group('codex', 'Codex', [
        { id: 'codex/gpt-6-luna', name: '[Codex] GPT-6 Luna' },
        { id: 'shared', name: 'Shared' },
      ]),
    ], null)
    expect(sections.map(section => section.id)).toEqual([MERGED_GROUP_ID, MAGPIE_ROUTING_PROVIDER])
    expect(sections[0]!.models.map(model => model.id)).toEqual(['codex/gpt-6-luna', 'shared'])
    expect(sections[1]!.models.map(model => model.id)).toEqual(['auto/gpt-6-luna', 'shared'])
    expect(sections[0]!.routeOf('shared')).toBe('codex')
    expect(sections[1]!.routeOf('shared')).toBe(MAGPIE_ROUTING_PROVIDER)
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

describe('draft switch guard', () => {
  it('blocks a switch while text or runtime attachment ids remain', () => {
    expect(draftBlocksSwitch({ draft: 'half typed', attachmentIds: [] })).toBe(true)
    expect(draftBlocksSwitch({ draft: '', attachmentIds: ['img-1'] })).toBe(true)
    expect(draftBlocksSwitch({ draft: '   ', attachmentIds: [] })).toBe(false)
    expect(draftBlocksSwitch({ draft: '', attachments: [{ id: 'x' }] })).toBe(true)
    expect(draftBlocksSwitch(null)).toBe(false)
  })

  it('recognizes route ownership for merged, routing and engine rows', () => {
    const sections = groupModelsForDisplay([
      group(MAGPIE_ROUTING_PROVIDER, 'Routing', [{ id: 'shared', name: 'Shared' }]),
      group('codex', 'Codex', [{ id: 'shared', name: 'Shared' }]),
      group('acp:agy', 'agy', [{ id: 'shared', name: 'Shared' }]),
    ], { provider: 'codex', model: 'shared' })
    expect(sections[0]!.hasRoute('shared', 'codex')).toBe(true)
    expect(sections[0]!.hasRoute('shared', MAGPIE_ROUTING_PROVIDER)).toBe(false)
    expect(sections[1]!.hasRoute('shared', MAGPIE_ROUTING_PROVIDER)).toBe(true)
    expect(sections[1]!.hasRoute('shared', 'codex')).toBe(false)
    expect(sections[2]!.hasRoute('shared', 'acp:agy')).toBe(true)
  })
})

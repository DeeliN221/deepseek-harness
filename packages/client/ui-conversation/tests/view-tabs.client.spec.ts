// @vitest-environment jsdom
/** Profile-backed ordered View tab preference and the header layout order it produces. */
import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSettings } from '../src/submission-settings.ts'
import type { ViewTab } from '../src/client/contract/views.ts'
import { ViewTabsPreference, preferredViewTabs } from '../src/client/view-tabs.ts'

/** Views with their id as the label, in registration order. */
function tabs(...ids: readonly string[]): readonly ViewTab[] {
  return ids.map(id => ({ id, label: id }))
}

/** One accepted form section. */
function section(viewTabs: ConversationSettings['viewTabs']): ConversationSettings {
  return { busyEnter: 'queue', viewTabs }
}

describe('preferredViewTabs', () => {
  it('leads with the fixed View and follows registration order while no selection exists', () => {
    expect(preferredViewTabs(tabs('trajectory', 'fleet', 'chat'), null).map(tab => tab.id))
      .toEqual(['chat', 'trajectory', 'fleet'])
  })

  it('follows the ordered selection, skips unregistered ids and a listed fixed View', () => {
    expect(preferredViewTabs(tabs('chat', 'trajectory', 'fleet'), ['fleet', 'missing', 'chat', 'trajectory']).map(tab => tab.id))
      .toEqual(['chat', 'fleet', 'trajectory'])
  })

  it('returns the ordered Views without a fixed lead when Chat is not registered', () => {
    expect(preferredViewTabs(tabs('trajectory', 'fleet'), ['fleet', 'trajectory']).map(tab => tab.id))
      .toEqual(['fleet', 'trajectory'])
    expect(preferredViewTabs(tabs('trajectory', 'fleet'), null).map(tab => tab.id))
      .toEqual(['trajectory', 'fleet'])
  })
})

describe('ViewTabsPreference', () => {
  it('keeps the automatic layout and an inert write path without a form', () => {
    const preference = new ViewTabsPreference()
    expect(preference.visible.getSnapshot()).toBeNull()
    preference.setVisible(['fleet'])
    expect(preference.visible.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
  })

  it('adopts the accepted form value and stops following after disposal', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    expect(preference.visible.getSnapshot()).toBeNull()
    form.publish({ status: 'ready', value: section(['fleet']) })
    expect(preference.visible.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
    expect(form.listenerCount()).toBe(0)
    form.publish({ status: 'ready', value: section(['trajectory']) })
    expect(preference.visible.getSnapshot()).toEqual(['fleet'])
  })

  it('writes an ordered selection once and skips an unchanged repetition', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    preference.setVisible(['fleet', 'trajectory'])
    expect(preference.visible.getSnapshot()).toEqual(['fleet', 'trajectory'])
    expect(form.set).toHaveBeenCalledExactlyOnceWith('viewTabs', ['fleet', 'trajectory'])
    preference.setVisible(['fleet', 'trajectory'])
    expect(form.set).toHaveBeenCalledTimes(1)
  })

  it('adopts a repeated accepted value without republishing, and returns to the automatic layout', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    form.publish({ status: 'ready', value: section(['fleet']) })
    const accepted = preference.visible.getSnapshot()
    form.publish({ status: 'ready', value: section(['fleet']) })
    expect(preference.visible.getSnapshot()).toBe(accepted)
    form.publish({ status: 'ready', value: section(null) })
    expect(preference.visible.getSnapshot()).toBeNull()
  })

  it('adopts the value published on the first accepted section from a loaded form', () => {
    const form = stubConfigForm<ConversationSettings>()
    form.publish({ status: 'ready', value: section(['fleet']) })
    const preference = new ViewTabsPreference(form.scope)
    expect(preference.visible.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
  })
})

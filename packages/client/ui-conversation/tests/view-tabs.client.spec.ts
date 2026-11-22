// @vitest-environment jsdom
/** Profile-backed View tab order and the header layout order it produces. */
import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSettings } from '../src/submission-settings.ts'
import type { ViewTab } from '../src/client/contract/views.ts'
import { ViewTabsPreference, orderedViewTabs } from '../src/client/view-tabs.ts'

/** Views with their id as the label, in registration order. */
function tabs(...ids: readonly string[]): readonly ViewTab[] {
  return ids.map(id => ({ id, label: id }))
}

/** One accepted form section. */
function section(viewTabs: ConversationSettings['viewTabs']): ConversationSettings {
  return { busyEnter: 'queue', viewTabs }
}

describe('orderedViewTabs', () => {
  it('leads with the fixed View and follows registration order while no order exists', () => {
    expect(orderedViewTabs(tabs('trajectory', 'fleet', 'chat'), null).map(tab => tab.id))
      .toEqual(['chat', 'trajectory', 'fleet'])
  })

  it('follows the ordered ids and appends unlisted Views in registration order', () => {
    expect(orderedViewTabs(tabs('chat', 'trajectory', 'fleet'), ['fleet']).map(tab => tab.id))
      .toEqual(['chat', 'fleet', 'trajectory'])
    expect(orderedViewTabs(tabs('chat', 'trajectory', 'fleet'), ['fleet', 'trajectory']).map(tab => tab.id))
      .toEqual(['chat', 'fleet', 'trajectory'])
  })

  it('skips unregistered ids and a listed fixed View without losing other Views', () => {
    expect(orderedViewTabs(tabs('chat', 'trajectory', 'fleet'), ['fleet', 'missing', 'chat', 'trajectory']).map(tab => tab.id))
      .toEqual(['chat', 'fleet', 'trajectory'])
  })

  it('returns the ordered Views without a fixed lead when Chat is not registered', () => {
    expect(orderedViewTabs(tabs('trajectory', 'fleet'), ['fleet']).map(tab => tab.id))
      .toEqual(['fleet', 'trajectory'])
    expect(orderedViewTabs(tabs('trajectory', 'fleet'), null).map(tab => tab.id))
      .toEqual(['trajectory', 'fleet'])
  })
})

describe('ViewTabsPreference', () => {
  it('keeps registration order and an inert write path without a form', () => {
    const preference = new ViewTabsPreference()
    expect(preference.order.getSnapshot()).toBeNull()
    preference.setOrder(['fleet'])
    expect(preference.order.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
  })

  it('adopts the accepted form value and stops following after disposal', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    expect(preference.order.getSnapshot()).toBeNull()
    form.publish({ status: 'ready', value: section(['fleet']) })
    expect(preference.order.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
    expect(form.listenerCount()).toBe(0)
    form.publish({ status: 'ready', value: section(['trajectory']) })
    expect(preference.order.getSnapshot()).toEqual(['fleet'])
  })

  it('writes an order once and skips an unchanged repetition', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    preference.setOrder(['fleet', 'trajectory'])
    expect(preference.order.getSnapshot()).toEqual(['fleet', 'trajectory'])
    expect(form.set).toHaveBeenCalledExactlyOnceWith('viewTabs', ['fleet', 'trajectory'])
    preference.setOrder(['fleet', 'trajectory'])
    expect(form.set).toHaveBeenCalledTimes(1)
  })

  it('adopts a repeated accepted value without republishing, and returns to registration order', () => {
    const form = stubConfigForm<ConversationSettings>()
    const preference = new ViewTabsPreference(form.scope)
    form.publish({ status: 'ready', value: section(['fleet']) })
    const accepted = preference.order.getSnapshot()
    form.publish({ status: 'ready', value: section(['fleet']) })
    expect(preference.order.getSnapshot()).toBe(accepted)
    form.publish({ status: 'ready', value: section(null) })
    expect(preference.order.getSnapshot()).toBeNull()
  })

  it('adopts the value published on the first accepted section from a loaded form', () => {
    const form = stubConfigForm<ConversationSettings>()
    form.publish({ status: 'ready', value: section(['fleet']) })
    const preference = new ViewTabsPreference(form.scope)
    expect(preference.order.getSnapshot()).toEqual(['fleet'])
    preference.dispose()
  })
})

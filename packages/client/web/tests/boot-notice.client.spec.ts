// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderBootNotice } from '../src/boot-notice.ts'

/** The single notice the shell renders after a degraded boot. */
function notice(): Element | null {
  return document.querySelector('[data-dsh-boot-notice]')
}

describe('renderBootNotice', () => {
  it('names every entry that did not start with its reason', () => {
    const detach = renderBootNotice([
      { id: '@deepseek-ai/dsh-client-ui-skill', reason: 'pending (waiting for service: uiConversation)' },
      { id: '@deepseek-ai/dsh-message-quotes', reason: 'import failed: bundle script failed to load' },
    ], document)

    expect(notice()?.textContent).toContain('2 plugins did not start')
    expect(notice()?.textContent).toContain('@deepseek-ai/dsh-client-ui-skill')
    expect(notice()?.textContent).toContain('pending (waiting for service: uiConversation)')
    expect(notice()?.textContent).toContain('@deepseek-ai/dsh-message-quotes')
    expect(notice()?.textContent).toContain('import failed: bundle script failed to load')
    expect(notice()?.getAttribute('role')).toBe('status')

    detach()
    expect(notice()).toBeNull()
  })

  it('uses the singular title and closes from its own control', () => {
    const detach = renderBootNotice([{ id: 'broken', reason: 'failed' }], document)

    expect(notice()?.textContent).toContain('1 plugin did not start')
    const dismiss = notice()?.querySelector('button')
    expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss the startup notice')
    dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(notice()).toBeNull()

    detach()
  })
})

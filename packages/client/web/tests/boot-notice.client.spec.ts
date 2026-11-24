// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderBootNotice } from '../src/boot-notice.ts'

const originalLanguage = document.documentElement.lang

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.lang = originalLanguage
})

/** The single notice the shell renders after a degraded boot. */
function notice(): Element | null {
  return document.querySelector('[data-dsh-boot-notice]')
}

describe('renderBootNotice', () => {
  it.each([
    ['en', '2 plugins did not start', 'The rest of the application keeps running. Settings → Plugins lists installed plugins.'],
    ['zh-CN', '2 个插件未启动', '应用的其他部分仍可使用。可在设置 → 插件中查看已安装的插件'],
    ['ZH-tw', '2 个插件未启动', '应用的其他部分仍可使用。可在设置 → 插件中查看已安装的插件'],
    ['fr', '2 plugins did not start', 'The rest of the application keeps running. Settings → Plugins lists installed plugins.'],
    ['', '2 plugins did not start', 'The rest of the application keeps running. Settings → Plugins lists installed plugins.'],
  ])('localizes notice copy for %s while preserving diagnostics', (language, title, hint) => {
    document.documentElement.lang = language
    const detach = renderBootNotice([
      { name: '@deepseek-ai/dsh-client-ui-skill', reason: 'pending (waiting for service: uiConversation)' },
      { name: '<broken-plugin>', reason: 'import failed: <script>alert("x")</script>' },
    ], document)
    try {
      const root = notice()
      expect(root?.getAttribute('role')).toBe('region')
      const heading = document.getElementById(root?.getAttribute('aria-labelledby') ?? '')
      expect(heading?.textContent).toBe(title)
      const status = root?.querySelector('[role="status"]')
      expect(status?.getAttribute('aria-live')).toBe('polite')
      expect(status?.textContent).toContain(title)
      expect(status?.textContent).toContain(hint)
      expect(status?.textContent).toContain('@deepseek-ai/dsh-client-ui-skill')
      expect(status?.textContent).toContain('pending (waiting for service: uiConversation)')
      expect(status?.textContent).toContain('<broken-plugin>')
      expect(status?.textContent).toContain('import failed: <script>alert("x")</script>')
      expect(root?.querySelector('script')).toBeNull()
      expect(status?.querySelector('button, a, input, [tabindex]')).toBeNull()
      expect(root?.querySelector('button')?.parentElement).toBe(root)
    } finally {
      detach()
    }
    expect(notice()).toBeNull()
  })

  it.each([
    ['en', '1 plugin did not start', 'Dismiss'],
    ['zh', '1 个插件未启动', '关闭'],
  ])('uses the singular title and closes from its visible %s control', (language, title, label) => {
    document.documentElement.lang = language
    const detach = renderBootNotice([{ name: 'broken', reason: 'failed' }], document)
    try {
      expect(notice()?.textContent).toContain(title)
      const dismiss = notice()?.querySelector('button')
      expect(dismiss?.textContent).toBe(label)
      expect(dismiss?.hasAttribute('aria-label')).toBe(false)
      dismiss?.click()
      expect(notice()).toBeNull()
    } finally {
      detach()
    }
  })

  it('keeps region labels distinct when notices coexist', () => {
    const first = renderBootNotice([{ name: 'first', reason: 'failed' }], document)
    const second = renderBootNotice([{ name: 'second', reason: 'pending' }], document)
    try {
      const roots = [...document.querySelectorAll('[data-dsh-boot-notice]')]
      const labels = roots.map(root => root.getAttribute('aria-labelledby'))
      expect(new Set(labels).size).toBe(2)
      for (const root of roots) expect(root.contains(document.getElementById(root.getAttribute('aria-labelledby')!))).toBe(true)
    } finally {
      first()
      second()
    }
  })
})

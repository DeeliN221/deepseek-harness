/** Real composer geometry and Session-bound clock lifecycle, without a model request. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('moves elapsed time into the dock and isolates running, ended and blank Sessions at desktop and mobile widths', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: Date.now() })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  expect(await page.getByRole('timer').count()).toBe(0)
  const agent = scaffold.ctx.agents.list()[0]
  if (agent === undefined) throw new Error('workspace did not create an Agent')
  await scaffold.ctx.sessionController.rename({ sessionId: agent.id, title: 'Elapsed clock session' })
  const start = agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Keep the composer clear while working.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('assistant/message', {
    turn: 1, step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text: 'Working.' }],
      source: { provider: 'fixture', model: 'fixture' } }),
    stream: [{ type: 'text-chunks', time0: Date.now() - 1_000, index: 0, dt: [200], texts: ['Working.'] }],
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 400 },
  }, { surfaceOp: 'append' })
  await expect.poll(() => page.locator('[data-composer-stat="usage"] button').count()).toBe(1)
  await page.locator('[data-composer-stat="usage"] button').click()
  expect(await page.getByRole('dialog', { name: 'Token usage' }).count()).toBe(1)
  await page.keyboard.press('Escape')
  await scaffold.ctx.settings.update('ui-chat', { performanceUsage: 'compact' })
  await expect.poll(() => page.locator('[data-composer-stat="usage"]').count()).toBe(0)
  await expect.poll(() => page.locator('[data-composer-stat="activity"]').count()).toBe(1)
  scaffold.ctx.emit('api-session/status', agent.id, true)
  await page.clock.setSystemTime(start.time + 967_000)
  const timer = page.getByRole('timer')
  await expect.poll(() => timer.count()).toBe(1)
  await page.clock.runFor(1_000)
  expect(await timer.innerText()).toMatch(/^16:0[78]$/)
  expect(await timer.getAttribute('aria-live')).toBe('off')
  expect(await timer.getAttribute('aria-label')).toContain('Elapsed time:')
  expect(await page.locator('[data-chat-running]').count()).toBe(0)
  expect(await timer.evaluate(element => element.closest('[data-slot="conversation.composer.dock"]') !== null)).toBe(true)
  const before = await timer.innerText()
  await page.clock.runFor(2_000)
  expect(await timer.innerText()).not.toBe(before)
  const output = process.env.DSH_ELAPSED_EVIDENCE_DIR
  if (output !== undefined) await mkdir(output, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.runFor(500)
    if (width === 390) {
      await page.waitForFunction(() => document.querySelector('[data-sidebar-drawer]') !== null)
      const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
      if (await collapse.isVisible()) await collapse.click()
      await page.clock.runFor(500)
    }
    const geometry = await timer.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width, scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
        uncovered: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }
    })
    expect(geometry.uncovered).toBe(true)
    expect(geometry.width).toBeGreaterThan(0)
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(width)
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport)
    if (output !== undefined) await page.screenshot({ animations: 'disabled', path: `${output}/running-${width}.png` })
  }
  scaffold.ctx.emit('api-session/status', agent.id, false)
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await scaffold.ctx.sessions.flush(agent.session)
  await expect.poll(() => timer.innerText()).toMatch(/^0:\d{2}$/)
  const final = await timer.innerText()
  await page.clock.runFor(5_000)
  expect(await timer.innerText()).toBe(final)
  if (output !== undefined) await page.screenshot({ animations: 'disabled', path: `${output}/ended-390.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.runFor(500)
  const openSidebar = page.getByRole('button', { name: 'Open sidebar', exact: true })
  if (await openSidebar.isVisible()) await openSidebar.click()
  await page.clock.runFor(500)
  await page.getByRole('button', { name: 'New session', exact: true }).last().click()
  await expect.poll(() => page.getByRole('timer').count()).toBe(0)
  if (output !== undefined) await page.screenshot({ animations: 'disabled', path: `${output}/blank-1440.png` })
  await page.getByRole('treeitem').filter({ has: page.getByText('Elapsed clock session', { exact: true }) }).click()
  await expect.poll(() => page.getByRole('timer').count()).toBe(1)
  expect(await page.getByRole('timer').innerText()).toBe(final)
  expect(console.pageErrors).toEqual([])
})

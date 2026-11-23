/** Real assembled composer, Host command persistence, and responsive dispatch controls. */
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('persists the session switch across reload, defaults a new session off, and fits desktop and mobile', async () => {
  const fixture = fileURLToPath(new URL('../../../snapshots/web/plan-narrow-viewport/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ replayFixture: fixture, replayProvidersOnly: true })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 900)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const control = page.getByRole('switch', { name: 'Async dispatch', exact: true })
  await expect.poll(() => control.getAttribute('aria-checked')).toBe('false')
  await control.click()
  try { await expect.poll(() => control.getAttribute('aria-checked')).toBe('true') }
  catch (error) {
    console.log('dispatch failure', await page.getByRole('alert').allTextContents(), scaffold.ctx.agents.list().map(agent => scaffold.ctx.sessionProjections.snapshot(agent.session)), tripwire)
    throw error
  }
  const evidence = join(process.cwd(), '.artifacts/async-dispatch')
  await mkdir(evidence, { recursive: true })
  await page.screenshot({ path: join(evidence, 'desktop-on.png'), fullPage: true })
  await page.reload({ waitUntil: 'load' })
  await expect.poll(() => control.getAttribute('aria-checked')).toBe('true')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-drawer]').waitFor()
  const collapseSidebar = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapseSidebar.isVisible()) await collapseSidebar.click()
  await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor()
  await page.keyboard.press('Escape')
  await expect.poll(() => control.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return hit !== null && element.contains(hit)
  })).toBe(true)
  await expect.poll(() => control.isVisible()).toBe(true)
  await expect.poll(async () => {
    const box = await control.boundingBox()
    return box !== null && box.x >= 0 && box.x + box.width <= 390
  }).toBe(true)
  const card = page.locator('[data-composer-card]')
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map(animation => animation.finished.catch(error => void error)))
  })
  await page.screenshot({ path: join(evidence, 'mobile-on.png'), fullPage: true })
  await control.click()
  await expect.poll(() => control.getAttribute('aria-checked')).toBe('false')
  await control.focus()
  await page.keyboard.press('Space')
  await expect.poll(() => control.getAttribute('aria-checked')).toBe('true')
  expect(scaffold.ctx.sessions.list().every(session => session.snapshotEvents().every(event => event.type !== 'request/header'))).toBe(true)
  const source = scaffold.ctx.agents.list().find(agent =>
    scaffold.ctx.sessionProjections.snapshot(agent.session).values.asyncDispatch === true)
  if (source === undefined) throw new Error('source Session missing')
  scaffold.ctx.sessionTitle.rename(source.session, 'Async source')
  source.session.append('turn/start', { turn: 1 })
  source.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await page.setViewportSize({ width: 1680, height: 900 })
  await page.getByRole('button', { name: 'New session', exact: true }).last().click()
  await expect.poll(() => control.getAttribute('aria-checked'), { timeout: 10_000 }).toBe('false')
  const freshId = new URL(page.url()).searchParams.get('session')
  expect(freshId).not.toBe(source.id)
  await page.getByText('Async source', { exact: true }).click()
  await expect.poll(() => control.getAttribute('aria-checked'), { timeout: 10_000 }).toBe('true')
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings.filter(warning => !/connection lost/i.test(warning))).toEqual([])
})

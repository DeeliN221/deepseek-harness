/** Single-View fallback uses the real header action and its portaled job menu. */
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('keeps single-View header jobs clickable outside the title clip in narrow columns', async () => {
  const scaffold = await launchWebScaffold({
    developerTools: false,
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
  })
  const resources: { browser?: Browser; jobId?: JobId } = {}
  const release = join(scaffold.workspaceCwd, '.single-view-header.release')
  const agent = { current: scaffold.ctx.agents.list()[0] }
  onTestFinished(async () => {
    try {
      await writeFile(release, '')
      if (resources.jobId !== undefined && agent.current !== undefined) {
        const settled = await scaffold.ctx.jobs.wait(resources.jobId, 15_000, agent.current.id)
        expect(['running', 'stopping']).not.toContain(settled.status)
      }
    } finally {
      try { await resources.browser?.close() } finally { await scaffold.close() }
    }
  })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  agent.current = scaffold.ctx.agents.list()[0]
  const owner = agent.current
  if (owner === undefined) throw new Error('workspace did not create an Agent')
  await scaffold.ctx.sessionController.rename({
    sessionId: owner.id, title: 'A deliberately long single View session title that must yield to real header actions',
  })
  owner.session.append('turn/start', { turn: 1 })
  owner.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Keep header menus reachable in a narrow conversation.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const quotedRelease = "'" + release.replaceAll("'", "'\\''") + "'"
  const started = await executeToolFixture(scaffold.ctx, {
    signal: new AbortController().signal,
    callId: brandString<ToolCallId>('single-view-header-job'), name: 'bash', agent: owner,
    arguments: {
      command: `printf 'single-view-ready\\n'; for _ in $(seq 1 3000); do [ -e ${quotedRelease} ] && break; sleep 0.2; done`,
      description: 'Hold the real single View header job menu open', run_in_background: true,
    },
  })
  const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
  const matched = /\bbash-[0-9a-f]{16}\b/.exec(reported)
  if (matched === null) throw new Error(`background bash reported no job id: ${reported}`)
  resources.jobId = brandString<JobId>(matched[0])
  const trigger = page.getByRole('button', { name: '1 background job', exact: true })
  await trigger.waitFor()
  expect(await page.getByRole('tablist').count()).toBe(0)
  expect(await trigger.evaluate(node => node.closest('[class*="titleCluster"]') === null)).toBe(true)
  const output = process.env.DSH_HEADER_EVIDENCE_DIR
  if (output !== undefined) await mkdir(output, { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    if (width <= 390) {
      await page.waitForFunction(() => document.querySelector('[data-sidebar-drawer]') !== null)
      const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
      if (await collapse.isVisible()) await collapse.click()
    }
    await expect.poll(() => trigger.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.left >= 0 && box.right <= innerWidth
        && [0.2, 0.5, 0.8].every(x => node.contains(document.elementFromPoint(box.x + box.width * x, box.y + box.height / 2)))
        && document.documentElement.scrollWidth <= innerWidth
    })).toBe(true)
    // Pointer click, menu interaction, Escape and outside dismissal cover hit
    // testing and portal visibility; a DOM-only presence assertion cannot.
    await trigger.click()
    const list = page.getByRole('list', { name: 'Background jobs' })
    await list.waitFor()
    const expand = list.getByRole('button', { name: /Show live output/ })
    if (await expand.count() > 0) await expand.click()
    await list.getByText('single-view-ready', { exact: true }).waitFor()
    if (output !== undefined) await page.screenshot({ path: `${output}/single-view-open-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await list.waitFor()
    await page.locator('[data-composer-input]').click()
    await list.waitFor({ state: 'detached' })
  }
  expect(console.pageErrors).toEqual([])
})

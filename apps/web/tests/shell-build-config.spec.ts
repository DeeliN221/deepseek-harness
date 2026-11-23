/**
 * Pin the published shell build's artifact contract: the bytes a browser
 * receives reference no sourcemap the package does not ship, and
 * content-hashed scripts and stylesheets carry at-rest brotli sidecars.
 */

import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'
import { expect, it } from 'vitest'

it('builds a publishable shell without sourcemap references and with brotli sidecars', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  )
  if (loaded === null) throw new Error('Expected the Web build configuration')
  // `hidden` keeps maps beside a local build, while the bytes publishing ships
  // (the package excludes `dist/**/*.map` and the preview workflow deletes them)
  // never point a browser at a file that is not there.
  expect(loaded.config.build?.sourcemap).toBe('hidden')

  const flattened: unknown[] = []
  const collect = (values: readonly unknown[]): void => {
    for (const value of values) {
      if (Array.isArray(value)) collect(value)
      else flattened.push(value)
    }
  }
  collect(loaded.config.plugins ?? [])
  const names = flattened.map((plugin) => {
    if (plugin === null || typeof plugin !== 'object' || !('name' in plugin)) return undefined
    return typeof plugin.name === 'string' ? plugin.name : undefined
  })
  expect(names).toContain('dsh-precompressed-assets')
})

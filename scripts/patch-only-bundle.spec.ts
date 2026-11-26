import { describe, expect, it } from 'vitest'
import { isPatchOnlyBundleManifest } from './patch-only-bundle.ts'

const patchOnly = {
  exports: {
    './cordis.patch.yml': './cordis.patch.yml',
    './package.json': './package.json',
  },
  files: ['cordis.patch.yml'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}

describe('patch-only bundle role', () => {
  it('recognizes a declarative bundle with no runtime source entry', () => {
    expect(isPatchOnlyBundleManifest(patchOnly)).toBe(true)
    expect(isPatchOnlyBundleManifest(patchOnly, true)).toBe(false)
  })

  it('supports a bundle that publishes multiple patch documents', () => {
    expect(isPatchOnlyBundleManifest({
      exports: {
        './cordis.patch.yml': './cordis.patch.yml',
        './layers/web.patch.yml': './layers/web.patch.yml',
        './package.json': './package.json',
      },
      files: ['cordis.patch.yml', 'layers/web.patch.yml'],
      dsh: { bundle: { patch: ['./cordis.patch.yml', './layers/web.patch.yml'] } },
    })).toBe(true)
  })

  it.each([
    { ...patchOnly, main: 'lib/index.js' },
    { ...patchOnly, types: 'lib/types/index.d.ts' },
    { ...patchOnly, exports: { ...patchOnly.exports, '.': { default: './lib/index.js' } } },
    { ...patchOnly, exports: { ...patchOnly.exports, './runtime': './lib/runtime.js' } },
    { ...patchOnly, files: ['cordis.patch.yml', 'lib/index.js'] },
    { ...patchOnly, dsh: { bundle: { patch: '../cordis.patch.yml' } } },
  ])('does not classify a runtime or malformed package as patch-only: %j', (manifest) => {
    expect(isPatchOnlyBundleManifest(manifest)).toBe(false)
  })
})

/**
 * At-rest precompression policy: a one-shot build that writes its output emits
 * one brotli sidecar per script and stylesheet output, at the at-rest quality,
 * and never beside a small output or a name that escapes the output directory.
 * A watch or dry build emits none, keeping the dev rebuild and the webserver's
 * gzip path unchanged.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { build } from 'vite'
import { expect, it, onTestFinished } from 'vitest'
import {
  isContentHashedOutput, precompressedAssets, precompressibleAssets, precompressesBuild, writePrecompressedAssets,
} from '../precompressed-assets.ts'
import type { PrecompressibleAsset } from '../precompressed-assets.ts'

/** A temp directory removed when the test that owns it finishes. */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-precompressed-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

it('writes sidecars only for a one-shot build that writes its output', () => {
  expect(precompressesBuild({ write: true, watch: null })).toBe(true)
  expect(precompressesBuild({ write: true, watch: undefined })).toBe(true)
  expect(precompressesBuild({ write: false, watch: null })).toBe(false)
  expect(precompressesBuild({ write: true, watch: {} })).toBe(false)
})

it('accepts a Vite hash and refuses names a version or a suffix could impersonate', () => {
  expect(isContentHashedOutput('assets/index-BgUyXZcc.js')).toBe(true)
  expect(isContentHashedOutput('assets/fonts/KaTeX_Math-Italic-t53AETM-.woff2')).toBe(true)
  expect(isContentHashedOutput('assets/langs/asciidoc-CSVQ5wI8.js')).toBe(true)
  // A date tail is a version, not a content hash.
  expect(isContentHashedOutput('assets/app-20240101.js')).toBe(false)
  // No hash at all, and a sourcemap suffix is not an extension-bearing hash.
  expect(isContentHashedOutput('main.js')).toBe(false)
  expect(isContentHashedOutput('assets/index-BgUyXZcc.js.map')).toBe(false)
  expect(isContentHashedOutput('index.html')).toBe(false)
})

it('selects only content-hashed scripts and stylesheets', () => {
  const bundle = {
    'assets/index-BgUyXZcc.js': { type: 'chunk', fileName: 'assets/index-BgUyXZcc.js', code: 'export {}' },
    'assets/index-lh_YM6sT.css': { type: 'asset', fileName: 'assets/index-lh_YM6sT.css', source: '.shell{}' },
    'assets/index-BgUyXZcc.js.map': { type: 'asset', fileName: 'assets/index-BgUyXZcc.js.map', source: '{}' },
    // A build that does not hash its output earns no sidecars at all.
    'main.js': { type: 'chunk', fileName: 'main.js', code: 'export {}' },
    'assets/app-20240101.js': { type: 'chunk', fileName: 'assets/app-20240101.js', code: 'export {}' },
    'index.html': { type: 'asset', fileName: 'index.html', source: '<!doctype html>' },
    'manifest.webmanifest': { type: 'asset', fileName: 'manifest.webmanifest', source: '{}' },
  } as const
  expect(precompressibleAssets(bundle)).toEqual([
    { fileName: 'assets/index-BgUyXZcc.js', source: 'export {}' },
    { fileName: 'assets/index-lh_YM6sT.css', source: '.shell{}' },
  ])
  expect(precompressibleAssets({ 'main.js': { type: 'chunk', fileName: 'main.js', code: 'export {}' } })).toEqual([])
})

it('writes a sidecar that decodes to the output bytes and skips small or escaping outputs', async () => {
  const root = await tempRoot()
  const outputs: PrecompressibleAsset[] = [
    { fileName: 'assets/index-BgUyXZcc.js', source: 'export const shell = 1\n'.repeat(64) },
    { fileName: 'assets/small-BgUyXZcc.css', source: '.a{}' },
    { fileName: '../escaped-BgUyXZcc.js', source: 'export const escaped = 1\n'.repeat(64) },
  ]
  const written = await writePrecompressedAssets(join(root, 'dist'), outputs)
  expect(written).toEqual([join(root, 'dist', 'assets', 'index-BgUyXZcc.js.br')])
  expect(brotliDecompressSync(await readFile(written[0]!)).toString()).toBe(outputs[0]!.source)
  // Running the pass again over the same dist rewrites the same artifact.
  expect(await writePrecompressedAssets(join(root, 'dist'), outputs)).toEqual(written)
  // Neither the undersized output nor the escaping name left an artifact.
  expect(await readdir(join(root, 'dist', 'assets'))).toEqual(['index-BgUyXZcc.js.br'])
  expect(await readdir(root)).toEqual(['dist'])
})

it('writes decodable sidecars in a real script-and-stylesheet build', async () => {
  const root = await tempRoot()
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'style.css'), Array.from(
    { length: 128 },
    (_, index) => `.shell-${String(index)} { color: rgb(${String(index)}, 0, 0); }\n`,
  ).join(''))
  // A literal the minifier keeps, so the script clears the at-rest threshold.
  await writeFile(join(root, 'src', 'main.js'), [
    "import './style.css'",
    `console.log(${JSON.stringify('shell '.repeat(512))})`,
    '',
  ].join('\n'))
  await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      write: true,
      outDir: 'dist',
      rollupOptions: {
        input: join(root, 'src', 'main.js'),
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [precompressedAssets()],
  })
  const outputs = await readdir(join(root, 'dist', 'assets'))
  const script = outputs.find(name => name.endsWith('.js'))
  const style = outputs.find(name => name.endsWith('.css'))
  if (script === undefined || style === undefined) throw new Error('the build emitted no script and stylesheet pair')
  for (const fileName of [script, style]) {
    const source = await readFile(join(root, 'dist', 'assets', fileName))
    const sidecar = await readFile(join(root, 'dist', 'assets', `${fileName}.br`))
    expect(brotliDecompressSync(sidecar)).toEqual(source)
    expect(sidecar.byteLength).toBeLessThan(source.byteLength)
  }
})

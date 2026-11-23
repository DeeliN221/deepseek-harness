/**
 * Build-time brotli sidecars for the shell's content-hashed script and
 * stylesheet outputs. The dist server
 * (`@deepseek-ai/dsh-host-frontend-static`) serves `<asset>.br` as the `br`
 * variant of an immutable asset and falls back to the identity bytes — which
 * the webserver gzips when it is configured to — for every other client.
 *
 * Compressing at rest rather than per request is what makes the slow brotli
 * settings affordable: quality 11 is roughly ten times the CPU of a streaming
 * quality and about 17% smaller than gzip 6 on these bundles, and a one-shot
 * publish build pays it once instead of on every warm load. A watch rebuild
 * keeps the webserver's gzip path, so editing the shell stays fast.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import { brotliCompress, constants } from 'node:zlib'
import type { Plugin } from 'vite'

/** At-rest quality: the maximum brotli setting, paid once per publish build. */
const BROTLI_QUALITY = 11

/**
 * Smallest output that earns a sidecar. Under this the response already fits
 * one packet, brotli's stream framing can outweigh the payload saving, and the
 * webserver's own compression threshold uses the same value.
 */
const SIDECAR_THRESHOLD_BYTES = 1024

/** Outputs whose text bytes brotli compresses well. */
const PRECOMPRESSIBLE_OUTPUT = /\.(?:js|css)$/

/**
 * Vite's content-hashed output name. Kept in step with the immutable rule in
 * `@deepseek-ai/dsh-host-frontend-static`: the server only serves a sidecar
 * beside a hashed name, so only those outputs earn one. The hash must hold a
 * letter, which rejects a numeric version or date tail.
 */
const CONTENT_HASHED = /^.+-([A-Za-z0-9_-]{8,})$/

/** One rollup output reduced to the fields precompression reads. */
export type PrecompressibleOutput =
  | { readonly type: 'chunk'; readonly fileName: string; readonly code: string }
  | { readonly type: 'asset'; readonly fileName: string; readonly source: string | Uint8Array }

/** One selected output and the bytes a sidecar must reproduce. */
export interface PrecompressibleAsset {
  /** Bundle-relative output path, for example `assets/index-BgUyXZcc.js`. */
  readonly fileName: string
  /** The exact bytes the build wrote for that output. */
  readonly source: string | Uint8Array
}

/** The `build` fields that decide whether sidecars are written. */
export interface PrecompressionScope {
  /** Vite's `build.write`; a dry run must not leave sidecars behind. */
  readonly write: boolean
  /** Vite's `build.watch`; a watch rebuild keeps the gzip path. */
  readonly watch: unknown
}

/**
 * Whether an output file name is content-hashed, and so served as an immutable
 * variant by the dist server.
 * @param fileName - bundle-relative output path.
 * @returns true only for a Vite-shaped `[name]-[hash][extname]` basename.
 */
export function isContentHashedOutput(fileName: string): boolean {
  const base = basename(fileName)
  const stem = base.slice(0, base.length - extname(base).length)
  const hash = CONTENT_HASHED.exec(stem)?.[1]
  return hash !== undefined && /[A-Za-z]/.test(hash)
}

/**
 * Select the outputs that carry a sidecar: a content-hashed script or
 * stylesheet. A build that names its output differently simply gets none, and
 * the dist server keeps the identity and gzip behaviour it had before.
 * @param bundle - rollup outputs of one build, keyed by file name.
 * @returns selected outputs in bundle order.
 */
export function precompressibleAssets(
  bundle: Readonly<Record<string, PrecompressibleOutput>>,
): PrecompressibleAsset[] {
  const selected: PrecompressibleAsset[] = []
  for (const output of Object.values(bundle)) {
    if (!PRECOMPRESSIBLE_OUTPUT.test(output.fileName)) continue
    if (!isContentHashedOutput(output.fileName)) continue
    selected.push({
      fileName: output.fileName,
      source: output.type === 'chunk' ? output.code : output.source,
    })
  }
  return selected
}

/**
 * Whether this build writes sidecars: a one-shot build that writes its output.
 * @param build - the resolved build fields carrying `write` and `watch`.
 * @returns true only for a non-watch build that writes its output.
 */
export function precompressesBuild(build: PrecompressionScope): boolean {
  return build.write && build.watch == null
}

/**
 * Compress one buffer at the at-rest settings.
 * @param bytes - the output bytes to compress.
 * @returns the brotli-encoded bytes.
 */
function compressAtRest(bytes: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolveCompressed, reject) => {
    brotliCompress(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    }, (error, compressed) => {
      if (error) reject(error)
      else resolveCompressed(compressed)
    })
  })
}

/**
 * Write one `<output>.br` beside each selected output.
 * @param directory - absolute build output directory.
 * @param assets - selected bundle outputs.
 * @returns the absolute sidecar paths written, in input order.
 */
export async function writePrecompressedAssets(
  directory: string,
  assets: readonly PrecompressibleAsset[],
): Promise<string[]> {
  const written: string[] = []
  await Promise.all(assets.map(async (asset) => {
    const bytes = typeof asset.source === 'string' ? Buffer.from(asset.source, 'utf8') : Buffer.from(asset.source)
    if (bytes.byteLength < SIDECAR_THRESHOLD_BYTES) return
    const sidecar = resolve(directory, `${asset.fileName}.br`)
    // Rollup owns output names; this guard only keeps a future naming change
    // from writing outside the output directory.
    if (!sidecar.startsWith(directory + sep)) return
    await mkdir(dirname(sidecar), { recursive: true })
    await writeFile(sidecar, await compressAtRest(bytes))
    written.push(sidecar)
  }))
  return written
}

/**
 * Vite plugin producing `<output>.br` sidecars for a publish build. The dist
 * server negotiates them; a client without brotli, and every mutable file,
 * keeps the response the webserver already produced.
 * @returns the plugin writing sidecars during `writeBundle`.
 */
export function precompressedAssets(): Plugin {
  let directory = ''
  let enabled = false
  return {
    name: 'dsh-precompressed-assets',
    configResolved(config) {
      directory = resolve(config.root, config.build.outDir)
      enabled = precompressesBuild(config.build)
    },
    async writeBundle(options, bundle) {
      if (!enabled) return
      await writePrecompressedAssets(options.dir ?? directory, precompressibleAssets(bundle))
    },
  }
}

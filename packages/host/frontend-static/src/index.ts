/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: a webserver resource serving the built frontend directory
 * with explicit index entry points. A readable index renders at the dist root
 * and configured index path; missing paths return 404, traversal outside the
 * dist root is 403, unknown extensions ship as octet-stream, and non-GET/HEAD
 * is 405. An HTTP index request first passes Connection's browser
 * authentication and renders for its admitted Peer; an in-process read renders
 * for the Peer its caller admitted. Both renders go through the webserver's
 * index render (structured injection rows, then raw taps). Non-index assets
 * stay public. A file whose name carries a Vite content hash
 * (`[name]-[hash][extname]`) is immutable — `cache-control: public,
 * max-age=31536000, immutable` with no validator — and, when its build emitted
 * a precompressed `<file>.br` sidecar, a request whose `Accept-Encoding`
 * admits brotli receives those bytes as the `br` variant. Every other file
 * keeps `cache-control: no-cache` and a weak ETag from a SHA-1 of its bytes,
 * answering a matching `If-None-Match` with 304. The index is
 * `cache-control: no-store` with no validator: its inlined boot graph must
 * never be replayed from a cache. The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PeerScope } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // Launchers require an image Content-Type for the install icons.
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // Font faces: the shell's first paint blocks on these, and a browser refuses
  // a face delivered as application/octet-stream.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

/** Revalidating cache contract for a file whose name carries no content hash. */
const REVALIDATE_CACHE = 'no-cache'

/** Immutable cache contract for a file whose name carries a content hash. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** The shell document embeds the boot graph, so a cache must never replay it. */
const SHELL_CACHE = 'no-store'

/** Suffix of a build-time brotli artifact written beside its source file. */
const BROTLI_SIDECAR = '.br'

/**
 * Vite's content-hashed file stem: `[name]-[hash]` before the extension, where
 * the hash is at least 8 base64url characters (Vite writes 8). The hash must
 * contain a letter, which rejects a numeric version or date tail
 * (`app-20240101`) that the alphabet alone would accept as a hash. A name that
 * fails this test keeps the revalidating contract, so a missed hash costs one
 * 304 rather than risking a stale immutable entry.
 */
const CONTENT_HASHED = /^.+-([A-Za-z0-9_-]{8,})$/

/** One Accept-Encoding entry: an optional `;q=` weight on a coding token. */
const ACCEPT_ENCODING_ENTRY = /^\s*([A-Za-z*]+)\s*(?:;\s*q\s*=\s*([0-9.]+))?\s*$/

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Whether a dist file name is content-hashed, and so safe to mark immutable.
 * @param target - the absolute file path about to be served.
 * @returns true only for a Vite-shaped `[name]-[hash][extname]` basename.
 */
function isContentHashed(target: string): boolean {
  const base = basename(target)
  const stem = base.slice(0, base.length - extname(base).length)
  const hash = CONTENT_HASHED.exec(stem)?.[1]
  return hash !== undefined && /[A-Za-z]/.test(hash)
}

/**
 * Whether an `Accept-Encoding` header admits brotli. An explicit `br` entry
 * decides (a weight of zero refuses); otherwise a `*` entry decides. An absent,
 * empty, or unparsable header admits nothing — matching the webserver, which
 * compresses nothing for a request that states no preference — so the caller
 * simply keeps the identity bytes.
 * @param header - the request's `Accept-Encoding` value, if any.
 * @returns true when the client accepts a brotli-encoded response.
 */
function acceptsBrotli(header: string | null): boolean {
  if (header === null) return false
  let explicit: boolean | undefined
  let wildcard = false
  for (const entry of header.split(',')) {
    const match = ACCEPT_ENCODING_ENTRY.exec(entry)
    if (match === null) continue
    const coding = String(match[1]).toLowerCase()
    const weight = match[2]
    const quality = weight === undefined ? 1 : Number(weight)
    const accepted = Number.isFinite(quality) && quality > 0
    if (coding === 'br') explicit = accepted
    else if (coding === '*') wildcard = accepted
  }
  return explicit ?? wildcard
}

/**
 * Read the build-time brotli artifact beside `target`.
 * @param target - the absolute path of the source file.
 * @returns the sidecar bytes, or undefined when no readable sidecar exists.
 */
async function readBrotliSidecar(target: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const bytes = await readFile(target + BROTLI_SIDECAR)
    // An empty artifact is an interrupted build, not a brotli stream; the
    // identity read below always has something valid to serve.
    return bytes.byteLength === 0 ? undefined : bytes
  } catch {
    // A sidecar is an optimization, never a correctness dependency: an absent
    // or unreadable artifact falls back to the identity read below, which
    // reports a genuinely broken dist through the caller's usual 404/400.
    return undefined
  }
}

/** A Response body that is `bytes` itself, without the copy a buffer body gets. */
function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Answer one GET or HEAD dist request; the webserver answers any other method
 * with 405 before a resource runs. A malformed percent-escape or a filesystem
 * failure other than a missing or non-file target rejects.
 * @param request - the request; only its method and URL path are read.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - present for index requests to turn the raw index.html
 * into the served document; omitted for ordinary static files.
 * @returns the dist response; a HEAD response carries the GET status and
 * headers without a body. The rendered index carries `cache-control: no-store`
 * and no validator. A content-hashed file carries `cache-control: public,
 * max-age=31536000, immutable`, `Vary: Accept-Encoding`, and no validator, and
 * its build-time brotli sidecar is served as the `br` variant when the request
 * admits brotli. Every other file carries `cache-control: no-cache` and a weak
 * ETag from a SHA-1 of its bytes, and a request whose `If-None-Match` equals
 * that ETag receives an empty 304.
 */
async function serveStatic(
  request: Request, distRoot: string, distIndex: string,
  renderIndex?: (html: string) => string,
): Promise<Response> {
  const target = resolve(normalize(join(distRoot, decodeURIComponent(new URL(request.url).pathname))))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
  let body: string | Uint8Array<ArrayBuffer>
  let headers: Record<string, string>
  try {
    if (renderIndex !== undefined) {
      const html = await readFile(distIndex, 'utf8')
      request.signal.throwIfAborted()
      body = renderIndex(html)
      headers = { 'content-type': HTML_MIME, 'cache-control': SHELL_CACHE }
    } else {
      const immutable = isContentHashed(target)
      const sidecar = immutable && acceptsBrotli(request.headers.get('accept-encoding'))
        ? await readBrotliSidecar(target)
        : undefined
      body = sidecar ?? await readFile(target)
      const type = MIME[extname(target)] ?? 'application/octet-stream'
      if (immutable) {
        // Every variant of one hashed URL is negotiated, so `Vary` is set even
        // on the identity bytes a shared cache could otherwise reuse for a
        // brotli-capable client.
        headers = {
          'content-type': type,
          'cache-control': IMMUTABLE_CACHE,
          vary: 'Accept-Encoding',
          ...(sidecar === undefined ? {} : { 'content-encoding': 'br', 'content-length': String(sidecar.byteLength) }),
        }
      } else {
        // Weak: gzip changes the transferred bytes.
        const cache = { 'cache-control': REVALIDATE_CACHE, etag: `W/"${createHash('sha1').update(body).digest('base64url')}"` }
        if (request.headers.get('if-none-match') === cache.etag) return new Response(null, { status: 304, headers: cache })
        headers = { 'content-type': type, ...cache }
      }
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the caller, which the webserver answers with 400 over HTTP.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    return new Response(null, { status: 404 })
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(typeof body === 'string' ? body : bytesBody(body), { status: 200, headers })
}

/**
 * Claim the webserver fallback seat with a resource serving the dist.
 * @param ctx - plugin context carrying the webServer and connection services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  ctx.effect(() => ctx.webServer.registerFallback({
    auth: (request) => {
      const target = resolve(normalize(join(distRoot, decodeURIComponent(request.url.pathname))))
      return target === distRoot || target === distIndex ? 'required' : 'anonymous'
    },
    resource: (request, peer) => {
      request.signal.throwIfAborted()
      const target = resolve(normalize(join(distRoot, decodeURIComponent(new URL(request.url).pathname))))
      if (target !== distRoot && target !== distIndex) return serveStatic(request, distRoot, distIndex)
      // WebServer admits every index request before invoking this resource.
      const pagePeer = peer as PeerScope
      const render = (html: string): string => {
        request.signal.throwIfAborted()
        pagePeer.signal.throwIfAborted()
        return ctx.webServer.renderIndex(html, pagePeer)
          .replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="./">`)
      }
      return serveStatic(request, distRoot, distIndex, render)
    },
  }), 'frontend-static: fallback seat')
}

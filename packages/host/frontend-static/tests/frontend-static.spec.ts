/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver and frontend-static rows, and every
 * assertion observes the served HTTP surface — asset serving, explicit index
 * entry points with index taps, 404 misses, traversal rejection, 405 on non-
 * GET/HEAD, cache contracts for hashed and unhashed names, precompressed
 * brotli sidecars, and seat release on fiber disposal (HMR safety).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import * as Token from '@deepseek-ai/dsh-host-authentication-token'
import { BrowserAuth } from '@deepseek-ai/dsh-host-authentication-token/src/browser-auth.ts'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as FrontendStatic from '../src/index.ts'

const heldIndex = vi.hoisted(() => ({
  path: undefined as string | undefined,
  entered: undefined as (() => void) | undefined,
  release: undefined as Promise<undefined> | undefined,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    readFile: async (...args: Parameters<typeof original.readFile>) => {
      if (args[0] === heldIndex.path) {
        heldIndex.entered?.()
        await heldIndex.release
      }
      return original.readFile(...args)
    },
  }
})

let root: string | undefined
let context: Context | undefined

/** A Vite-shaped chunk name and the bytes its brotli sidecar compresses. */
const HASHED_NAME = 'index-BgUyXZcc.js'
const HASHED_SOURCE = 'export const hashed = "shell chunk"'
const HASHED_BROTLI = brotliCompressSync(Buffer.from(HASHED_SOURCE))

/** A hashed name whose build emitted no sidecar: the pre-change dist shape. */
const NO_SIDECAR_NAME = 'nosidecar-CickPsom.js'
const NO_SIDECAR_SOURCE = 'compressible shell response '.repeat(8)

/** Cache contracts the dist server promises. */
const IMMUTABLE = 'public, max-age=31536000, immutable'

afterEach(async () => {
  heldIndex.path = undefined
  heldIndex.entered = undefined
  heldIndex.release = undefined
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a dist fixture and the authenticated Web rows, then boot them through the real Loader. */
async function loadComposition(gzip = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-frontend-static-'))
  const dist = join(root, 'dist')
  await mkdir(dist)
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>shell</body>')
  await writeFile(join(dist, 'app.js'), 'export {}')
  await writeFile(join(dist, 'preview.html'), '<body>preview</body>')
  await writeFile(join(dist, 'blob.bin'), 'BLOB')
  await writeFile(join(dist, 'manifest.webmanifest'), '{}')
  await writeFile(join(dist, 'icon-192.png'), 'PNG')
  await mkdir(join(dist, 'empty'))
  const assets = join(dist, 'assets')
  await mkdir(join(assets, 'fonts'), { recursive: true })
  // A Vite-named shell chunk with the brotli sidecar its build emits.
  await writeFile(join(assets, HASHED_NAME), HASHED_SOURCE)
  await writeFile(join(assets, `${HASHED_NAME}.br`), HASHED_BROTLI)
  // The same hashed shape without a sidecar: a dist built before the shell
  // build emitted them, or by a build that skipped precompression.
  await writeFile(join(assets, NO_SIDECAR_NAME), NO_SIDECAR_SOURCE)
  // A hashed name whose sidecar an interrupted build left empty.
  await writeFile(join(assets, 'truncated-CickPsom.js'), 'truncated shell chunk')
  await writeFile(join(assets, 'truncated-CickPsom.js.br'), '')
  // A sidecar beside a name without a content hash: it must never be served as
  // the br variant, because that name may change its bytes in place.
  await writeFile(join(assets, 'app.js'), 'export {}')
  await writeFile(join(assets, 'app.js.br'), brotliCompressSync(Buffer.from('export {}')))
  // A numeric tail is a version, not a content hash.
  await writeFile(join(assets, 'dated-20240101.js'), 'export {}')
  // Font faces the first paint blocks on, under Vite's hashed asset names.
  await writeFile(join(assets, 'fonts', 'montserrat-regular-DYep38cA.woff2'), 'WOFF2')
  await writeFile(join(assets, 'fonts', 'legacy-C3H0VqGB.woff'), 'WOFF')
  await writeFile(join(assets, 'fonts', 'legacy-D1sUS0GD.ttf'), 'TTF')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: '${join(root, '.credentials.yaml')}'`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    ...(gzip ? ['    compression: gzip', '    compressionThresholdBytes: 16'] : []),
    "- name: '@deepseek-ai/dsh-client-connection'",
    "- name: '@deepseek-ai/dsh-host-authentication-token'",
    '- id: frontend',
    "  name: '@deepseek-ai/dsh-host-frontend-static'",
    '  config:',
    `    distIndex: '${distIndex}'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-host-authentication-token', Token],
    ['@deepseek-ai/dsh-host-frontend-static', FrontendStatic],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** GET (by default) one path against the running server; returns status, content-type, and the body. */
async function request(
  port: number | undefined,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; type: string | null; body: string }> {
  if (port === undefined) throw new Error('frontend-static test: the listener has not bound a port')
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body: await response.text(),
  }
}

/** One node:http exchange, so a transport encoding reaches the assertion undecoded. */
async function rawRequest(
  port: number | undefined,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  if (port === undefined) throw new Error('frontend-static test: the listener has not bound a port')
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>()
  const outgoing = httpRequest({
    host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers,
  }, (incoming) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      resolve({
        status: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: Buffer.concat(chunks),
      })
    })
    incoming.on('error', reject)
  })
  outgoing.on('error', reject)
  outgoing.end()
  return promise
}

describe('real Loader composition', () => {
  it('serves explicit index entries and files while preserving HTTP error semantics', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    const server = loaded.webServer
    const port = server.port
    const auth = await BrowserAuth.create(loaded[Context.root], loaded.credentials, 30)
    const launchUrl = new URL(auth.authenticatedUrl(`http://127.0.0.1:${String(port)}`))
    const exchange = await fetch(launchUrl, { redirect: 'manual' })
    expect(exchange.status).toBe(303)
    expect(exchange.headers.get('location')).toBe('./')
    const setCookie = exchange.headers.get('set-cookie')
    if (setCookie === null) throw new Error('authenticated frontend did not set a cookie')
    const cookie = setCookie.split(';', 1)[0]!
    const authenticated = (init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers)
      headers.set('cookie', cookie)
      return { ...init, headers }
    }

    expect(await request(port, '/')).toMatchObject({
      status: 401,
      type: null,
      body: 'unauthorized',
    })

    // Real assets with their MIME types; a live rebuild is served on the next read.
    expect(await request(port, '/app.js')).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8', body: 'export {}' })
    expect(await request(port, '/manifest.webmanifest')).toMatchObject({
      status: 200,
      type: 'application/manifest+json',
      body: '{}',
    })
    // The install icons are images; a launcher must not receive them as octet-stream.
    expect(await request(port, '/icon-192.png')).toMatchObject({ status: 200, type: 'image/png', body: 'PNG' })
    expect(await request(port, '/app.js', { method: 'HEAD' })).toEqual({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      body: '',
    })
    await writeFile(join(root!, 'dist', 'app.js'), 'export const rebuilt = true')
    expect(await request(port, '/app.js')).toMatchObject({ status: 200, body: 'export const rebuilt = true' })

    // Unknown extension ships as octet-stream.
    expect(await request(port, '/blob.bin')).toMatchObject({ status: 200, type: 'application/octet-stream', body: 'BLOB' })

    // Only the root and index path render index.html through registered taps.
    const untap = server.tapIndex(html => html.replace('<head>', '<head><script>window.__T__=1</script>'))
    // A plugin row stands in for the Host's plugin-resource rows: the base the
    // shell inserts must precede it, not merely exist.
    const renderedFor: Connection.PeerScope[] = []
    const offRows = loaded.on('webserver/index-inject', (rows, peer) => {
      renderedFor.push(peer)
      rows.push({ kind: 'script-preload', src: 'plugins/boot.js' })
    })
    expect((await request(port, '/index.html?token=ordinary-query')).status).toBe(401)
    for (const path of ['/', '/index.html', '/?view=test', '/index.html?token=ordinary-query']) {
      const got = await request(port, path, authenticated())
      expect(got.status).toBe(200)
      expect(got.type).toBe('text/html; charset=utf-8')
      expect(got.body).toContain('__T__')
      expect(got.body).toContain('shell')
      // The served document carries the entry-directory base exactly once, and
      // it precedes every injected row and tap markup, so the shell's
      // app-owned routes and the Host's resource rows resolve under one mount.
      expect(got.body.match(/<base\b/g)).toHaveLength(1)
      const base = got.body.indexOf('<base href="./">')
      expect(base).toBeLessThan(got.body.indexOf('<link rel="preload" as="script" href="plugins/boot.js">'))
      expect(base).toBeLessThan(got.body.indexOf('<script>window.__T__=1</script>'))
    }
    // Default-token requests render for the Peer owned by the token provider.
    const admission = loaded.connection.authentication.authenticate({ headers: { host: `127.0.0.1:${String(port)}`, cookie } })
    if ('rejection' in admission) throw new Error('token provider refused its issued Cookie')
    expect(admission.peer).not.toBe(loaded.connection.browserPeer)
    expect(renderedFor).toEqual([admission.peer, admission.peer, admission.peer, admission.peer])
    offRows()
    expect(await request(port, '/', authenticated({ method: 'HEAD' }))).toEqual({
      status: 200,
      type: 'text/html; charset=utf-8',
      body: '',
    })
    untap()
    expect((await request(port, '/', authenticated())).body).not.toContain('__T__')

    // A missing configured index follows the same empty-404 contract for both
    // of its public entry paths and for both supported methods.
    await rm(join(root!, 'dist', 'index.html'))
    for (const path of ['/', '/index.html']) {
      const get = await request(port, path, authenticated())
      const head = await request(port, path, authenticated({ method: 'HEAD' }))
      expect(get).toEqual({ status: 404, type: null, body: '' })
      expect(head).toEqual(get)
    }

    // Ordinary unknown paths and static-resource misses are empty 404s for
    // both GET and HEAD; neither class can be mistaken for the HTML shell.
    const ordinaryMisses = ['/no/such/route', '/empty', '/app.js/child']
    const assetMisses = [
      '/missing.js',
      '/missing.css',
      '/missing.mjs',
      '/missing.js.map',
      '/missing.webmanifest',
      '/missing.manifest',
    ]
    for (const path of [...ordinaryMisses, ...assetMisses]) {
      const get = await request(port, path)
      const head = await request(port, path, { method: 'HEAD' })
      expect(get).toEqual({ status: 404, type: null, body: '' })
      expect(head).toEqual(get)
    }
    expect(await request(port, '/api/no/such/route', authenticated())).toEqual({
      status: 404,
      type: 'text/plain;charset=UTF-8',
      body: 'not found',
    })

    // Traversal outside the dist root is 403, non-GET/HEAD is 405, and a
    // malformed filesystem target still reaches the webserver's 400 guard.
    expect((await request(port, '/..%2f..%2fetc%2fpasswd')).status).toBe(403)
    expect((await request(port, '/app.js', { method: 'POST' })).status).toBe(405)
    expect((await request(port, '/bad%00path')).status).toBe(400)

    // HMR safety: disposing the frontend row releases the fallback seat (the
    // unclaimed webserver answers 404) and the seat is claimable again.
    const frontendEntry = [...loaded.loader.entries()].find(e => e.options.id === 'frontend')
    expect(frontendEntry).toBeDefined()
    await frontendEntry!.fiber?.dispose()
    expect((await request(port, '/no/such/route')).status).toBe(404)
    expect(() => server.registerFallback(() => {})).not.toThrow()
  })

  it('uses centralized HTTP admission while public files and in-process reads stay independent', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const reader = loaded.connection.createPeer({ principal: { kind: 'owner' } })
    let attempts = 0
    loaded.connection.authentication.register({ authenticate() {
      attempts++
      return undefined
    } })
    for (const path of ['/app.js', '/preview.html', '/missing.js', '/..%2f..%2foutside']) await request(loaded.webServer.port, path)
    expect(attempts).toBe(0)
    const inProcess = await loaded.webServer.readResource(new Request('http://reader.invalid/'), reader)
    await inProcess.text()
    expect(attempts).toBe(0)
    expect((await request(loaded.webServer.port, '/')).status).toBe(401)
    expect(attempts).toBe(1)
    expect((await request(loaded.webServer.port, '/index.html', { method: 'HEAD' })).status).toBe(401)
    expect(attempts).toBe(2)
  })

  it('renders each HTTP index for the Peer returned by page admission', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const reader = loaded.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
    expect(reader).not.toBe(loaded.connection.browserPeer)
    let attempts = 0
    const unregister = loaded.connection.authentication.register({
      authenticate(input) {
        attempts++
        const value = input.headers instanceof Headers ? input.headers.get('x-reader') : input.headers['x-reader']
        return value === 'external' ? reader : undefined
      },
    })
    const renderedFor: Connection.PeerScope[] = []
    loaded.on('webserver/index-inject', (rows, peer) => {
      renderedFor.push(peer)
      rows.push({ kind: 'global', name: '__READER__', value: peer === reader })
    })
    for (const path of ['/', '/index.html']) {
      const response = await request(loaded.webServer.port, path, { headers: { 'x-reader': 'external' } })
      expect(response.status).toBe(200)
      expect(response.body).toContain('globalThis["__READER__"] = true')
    }
    expect(renderedFor).toEqual([reader, reader])
    expect(attempts).toBe(2)
    await unregister()
    expect((await request(loaded.webServer.port, '/', { headers: { 'x-reader': 'external' } })).status).toBe(401)
  })

  it('reports unavailable authentication without rendering the index', async () => {
    const loaded = await loadComposition()
    loaded.connection.authentication.register({ authenticate() { throw new Error('provider unavailable') } })
    const rendered = vi.fn()
    loaded.on('webserver/index-inject', rendered)
    for (const path of ['/', '/index.html']) {
      expect(await request(loaded.webServer.port, path)).toMatchObject({ status: 503, body: 'authentication unavailable' })
      expect(await request(loaded.webServer.port, path, { method: 'HEAD' })).toMatchObject({ status: 503, body: '' })
    }
    expect(rendered).not.toHaveBeenCalled()
  })

  it.each(['request', 'peer'] as const)('does not inject an index after its %s ends during file reading', { timeout: 60_000 }, async (ended) => {
    const loaded = await loadComposition()
    const reader = loaded.connection.createPeer({ principal: { kind: 'owner' } })
    const controller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    heldIndex.path = join(root!, 'dist', 'index.html')
    heldIndex.entered = () => { entered.resolve(undefined) }
    heldIndex.release = release.promise
    const renderedFor: Connection.PeerScope[] = []
    loaded.on('webserver/index-inject', (_rows, peer) => { renderedFor.push(peer) })
    const result = loaded.webServer.readResource(new Request('http://reader.invalid/', { signal: controller.signal }), reader)
    const outcome = result.then(() => 'served', () => 'cancelled')
    try {
      await entered.promise
      if (ended === 'request') controller.abort()
      else await reader.dispose()
      release.resolve(undefined)
      expect(await outcome).toBe('cancelled')
      expect(renderedFor).toEqual([])
    } finally {
      release.resolve(undefined)
      await outcome
    }
  })

  it('answers in-process reads for the given Peer without browser authentication', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const server = loaded.webServer
    const reader = loaded.connection.createPeer({ principal: { kind: 'owner' } })
    const read = (path: string, init?: RequestInit) => server.readResource(new Request(`http://reader.invalid${path}`, init), reader)
    const renderedFor: Connection.PeerScope[] = []
    loaded.on('webserver/index-inject', (rows, peer) => {
      renderedFor.push(peer)
      rows.push({ kind: 'global', name: '__READER__', value: peer === reader })
    })

    // The index renders for the reader's Peer with no cookie or token, and
    // keeps the entry-directory base ahead of the injected rows.
    for (const path of ['/', '/index.html']) {
      const index = await read(path)
      expect(index.status).toBe(200)
      expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8')
      const html = await index.text()
      expect(html).toContain('globalThis["__READER__"] = true')
      expect(html.indexOf('<base href="./">')).toBeLessThan(html.indexOf('__READER__'))
      expect(html).toContain('shell')
    }
    expect(renderedFor).toEqual([reader, reader])
    const head = await read('/', { method: 'HEAD' })
    expect({ status: head.status, type: head.headers.get('content-type'), body: await head.text() })
      .toEqual({ status: 200, type: 'text/html; charset=utf-8', body: '' })

    // Assets, misses, traversal, and methods keep the HTTP semantics.
    const asset = await read('/app.js')
    expect({ status: asset.status, type: asset.headers.get('content-type'), body: await asset.text() })
      .toEqual({ status: 200, type: 'text/javascript; charset=utf-8', body: 'export {}' })
    expect((await read('/missing.js')).status).toBe(404)
    expect((await read('/..%2f..%2fetc%2fpasswd')).status).toBe(403)
    expect((await read('/app.js', { method: 'POST', body: 'x' })).status).toBe(405)
    await expect(read('/bad%00path')).rejects.toThrow()
    await rm(join(root!, 'dist', 'index.html'))
    expect((await read('/')).status).toBe(404)
  })

  it('lets browsers revalidate every mutable file while the shell is never stored', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const base = `http://127.0.0.1:${String(loaded.webServer.port)}`
    const first = await fetch(`${base}/app.js`)
    const etag = first.headers.get('etag')
    if (etag === null) throw new Error('a dist file carried no ETag')
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/)
    expect(first.headers.get('cache-control')).toBe('no-cache')
    expect(await first.text()).toBe('export {}')

    const revalidated = await fetch(`${base}/app.js`, { headers: { 'if-none-match': etag } })
    expect([revalidated.status, revalidated.headers.get('etag'), revalidated.headers.get('cache-control')]).toEqual([304, etag, 'no-cache'])
    expect(await revalidated.text()).toBe('')
    // An in-process read revalidates the same way.
    const reader = loaded.connection.createPeer({ principal: { kind: 'owner' } })
    const read = await loaded.webServer.readResource(new Request(`${base}/app.js`, { headers: { 'if-none-match': etag } }), reader)
    expect(read.status).toBe(304)

    // New content under the same name changes the ETag, so the stale copy is replaced.
    await writeFile(join(root!, 'dist', 'app.js'), 'export const rebuilt = true')
    const rebuilt = await fetch(`${base}/app.js`, { headers: { 'if-none-match': etag } })
    expect(rebuilt.status).toBe(200)
    expect(rebuilt.headers.get('etag')).not.toBe(etag)
    expect(await rebuilt.text()).toBe('export const rebuilt = true')

    // Another HTML file revalidates; the rendered shell is never stored, and
    // carries no validator a conditional request could match.
    const html = await fetch(`${base}/preview.html`)
    expect([html.status, html.headers.get('cache-control')]).toEqual([200, 'no-cache'])
    expect(html.headers.get('etag')).toMatch(/^W\//)
    expect(await html.text()).toBe('<body>preview</body>')
    const index = await loaded.webServer.readResource(new Request(`${base}/`), reader)
    expect([index.status, index.headers.get('cache-control'), index.headers.get('etag')]).toEqual([200, 'no-store', null])
  })

  it('marks only Vite content-hashed names immutable and serves font faces as fonts', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port

    const hashed = await rawRequest(port, `/assets/${HASHED_NAME}`)
    expect([hashed.status, hashed.headers['content-type'], hashed.headers['cache-control']]).toEqual([
      200, 'text/javascript; charset=utf-8', IMMUTABLE,
    ])
    expect(hashed.headers.etag).toBeUndefined()
    expect(hashed.headers.vary).toBe('Accept-Encoding')
    expect(hashed.body.toString()).toBe(HASHED_SOURCE)
    // A validator from before the switch cannot turn an immutable file into a 304.
    expect((await rawRequest(port, `/assets/${HASHED_NAME}`, { headers: { 'if-none-match': 'W/"stale"' } })).status).toBe(200)

    // Font faces keep their font MIME, and their hashed names make them immutable.
    for (const [path, type] of [
      ['/assets/fonts/montserrat-regular-DYep38cA.woff2', 'font/woff2'],
      ['/assets/fonts/legacy-C3H0VqGB.woff', 'font/woff'],
      ['/assets/fonts/legacy-D1sUS0GD.ttf', 'font/ttf'],
    ] as const) {
      const font = await rawRequest(port, path)
      expect([font.status, font.headers['content-type'], font.headers['cache-control']]).toEqual([200, type, IMMUTABLE])
    }

    // A numeric tail is a version, not a content hash: it keeps revalidating.
    const dated = await rawRequest(port, '/assets/dated-20240101.js')
    expect(dated.headers['cache-control']).toBe('no-cache')
    expect(dated.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/)
    // The sidecar file itself is not a hashed asset name either.
    const sidecarPath = await rawRequest(port, `/assets/${HASHED_NAME}.br`)
    expect([sidecarPath.status, sidecarPath.headers['cache-control']]).toEqual([200, 'no-cache'])
    // A hashed-looking path outside the dist root stays traversal, never a cache hit.
    expect((await rawRequest(port, `/..%2f..%2fassets%2f${HASHED_NAME}`)).status).toBe(403)
  })

  it('serves the build-time brotli sidecar only to clients that accept it', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port
    const asset = `/assets/${HASHED_NAME}`

    const br = await rawRequest(port, asset, { headers: { 'accept-encoding': 'gzip, deflate, br' } })
    expect([br.status, br.headers['content-encoding']]).toEqual([200, 'br'])
    expect(br.headers['content-length']).toBe(String(HASHED_BROTLI.length))
    expect(br.headers.vary).toBe('Accept-Encoding')
    expect(brotliDecompressSync(br.body).toString()).toBe(HASHED_SOURCE)

    // Weights and wildcards decide like any negotiated coding.
    const negotiated = [
      ['br', 'br'],
      ['*', 'br'],
      ['gzip;q=1, br;q=0.5', 'br'],
      ['br;q=0, *', undefined],
      ['br;q=1..', undefined],
      ['gzip', undefined],
      ['identity', undefined],
      [';;', undefined],
    ] as const
    for (const [header, encoding] of negotiated) {
      const variant = await rawRequest(port, asset, { headers: { 'accept-encoding': header } })
      expect([header, variant.headers['content-encoding']]).toEqual([header, encoding])
      const body = encoding === 'br' ? brotliDecompressSync(variant.body) : variant.body
      expect(body.toString()).toBe(HASHED_SOURCE)
    }

    // A HEAD response advertises the same variant without a body.
    const head = await rawRequest(port, asset, { method: 'HEAD', headers: { 'accept-encoding': 'br' } })
    expect([head.status, head.headers['content-encoding'], head.body.length]).toEqual([200, 'br', 0])

    // An in-process read sees the same negotiated bytes.
    const reader = { principal: { kind: 'owner' } } as Connection.PeerScope
    const inProcess = await loaded.webServer.readResource(
      new Request(`http://reader.invalid${asset}`, { headers: { 'accept-encoding': 'br' } }),
      reader,
    )
    expect(inProcess.headers.get('content-encoding')).toBe('br')
    expect(brotliDecompressSync(Buffer.from(await inProcess.arrayBuffer())).toString()).toBe(HASHED_SOURCE)

    // A hashed file the build did not precompress keeps its identity bytes.
    const noSidecar = await rawRequest(port, '/assets/fonts/montserrat-regular-DYep38cA.woff2', { headers: { 'accept-encoding': 'br' } })
    expect([noSidecar.headers['content-encoding'], noSidecar.body.toString()]).toEqual([undefined, 'WOFF2'])
    const degraded = await rawRequest(port, `/assets/${NO_SIDECAR_NAME}`, { headers: { 'accept-encoding': 'br' } })
    expect([degraded.headers['content-encoding'], degraded.body.toString()]).toEqual([undefined, NO_SIDECAR_SOURCE])
    // An empty sidecar (an interrupted build) is not served as a variant.
    const truncated = await rawRequest(port, '/assets/truncated-CickPsom.js', { headers: { 'accept-encoding': 'br' } })
    expect([truncated.headers['content-encoding'], truncated.body.toString()]).toEqual([undefined, 'truncated shell chunk'])
    // A sidecar beside a non-hashed name is never served: that name may change
    // its bytes in place, so serving precompressed bytes would go stale.
    const mutable = await rawRequest(port, '/assets/app.js', { headers: { 'accept-encoding': 'br' } })
    expect([mutable.headers['content-encoding'], mutable.body.toString()]).toEqual([undefined, 'export {}'])
    expect(mutable.headers['cache-control']).toBe('no-cache')
  })

  it('keeps one transport encoding per response when the webserver compresses', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(true)
    const port = loaded.webServer.port
    const asset = `/assets/${HASHED_NAME}`

    // The sidecar variant carries its own Content-Encoding, so the webserver
    // must pass it through instead of wrapping already-encoded bytes.
    const brVariant = await rawRequest(port, asset, { headers: { 'accept-encoding': 'br' } })
    expect(brVariant.headers['content-encoding']).toBe('br')
    expect(brVariant.headers['content-length']).toBe(String(HASHED_BROTLI.length))
    expect(brotliDecompressSync(brVariant.body).toString()).toBe(HASHED_SOURCE)

    // A client without brotli gets the identity bytes through the existing gzip path.
    const gzipVariant = await rawRequest(port, asset, { headers: { 'accept-encoding': 'gzip' } })
    expect(gzipVariant.headers['content-encoding']).toBe('gzip')
    expect(gzipVariant.headers.vary).toContain('Accept-Encoding')
    expect(gunzipSync(gzipVariant.body).toString()).toBe(HASHED_SOURCE)

    // A sidecar-less hashed asset degrades to the identity bytes and the
    // webserver's single gzip pass: no double encoding, no truncated body.
    const degraded = await rawRequest(port, `/assets/${NO_SIDECAR_NAME}`, { headers: { 'accept-encoding': 'br, gzip' } })
    expect(degraded.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(degraded.body).toString()).toBe(NO_SIDECAR_SOURCE)

    // Mutable assets keep the gzip path they had before the cache change.
    const mutable = await rawRequest(port, '/app.js', { headers: { 'accept-encoding': 'gzip' } })
    expect(mutable.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(mutable.body).toString()).toBe('export {}')
  })
})

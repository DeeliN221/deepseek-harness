/** Authenticated owner operations traverse real Gateway dispatch and local filesystem storage. */
import { readFile, writeFile, unlink, symlink } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SessionStore from '@deepseek-ai/dsh-session'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { remoteErrorOf, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceFiles from '../src/index.ts'
import { openWorkspace, signal, type Harness } from './harness.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Non-owner fixture, even when granted all owner-file Remote actions. */
    'workspace-file-test-guest': { readonly kind: 'workspace-file-test-guest' }
  }
}

let harness: Harness
let owner: PeerScope
let guest: PeerScope

beforeEach(async () => {
  harness = await openWorkspace('dsh-owner-files-', SandboxedFileSystem)
  const ctx = harness.ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGateway)
  await ctx.plugin(WorkspaceFiles, {
    maxBytes: 64, maxFileBytes: 128, maxLines: 100, maxEntries: 2,
    search: { maxResults: 100, maxEntries: 1000, graceMs: 3000, timeoutMs: 30000, stderrMaxBytes: 65536 },
  })
  owner = new Peer(ctx, { principal: { kind: 'owner' } })
  guest = new Peer(ctx, { principal: { kind: 'workspace-file-test-guest' } })
  ctx.remoteAccess.registerPolicy('workspace-file-test-guest', {
    bindings: () => [{
      resource: { kind: 'global' },
      role: { name: 'test-all-owner-file-actions', resource: 'global', actions: [
        'workspaceFiles/ownerList', 'workspaceFiles/ownerRead', 'workspaceFiles/ownerStat',
        'workspaceFiles/ownerChanges', 'workspaceFiles/saveText',
      ] },
    }],
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await harness.ctx.fiber.dispose()
  await harness.dispose()
})

function call(method: string, args: Record<string, unknown>, peer = owner) {
  return harness.ctx.typertGateway.invoke({ peer, namespace: 'workspaceFiles', method, args })
}

async function version(path: string): Promise<string> {
  const info = await harness.ctx.fs.stat(await harness.ctx.fs.resolve(path))
  if (info === undefined) throw new Error('fixture file missing')
  return info.version
}

it('lists an arbitrary directory with canonical parent, bounded entries and root navigation', async () => {
  await Promise.all(['a', 'b', 'c'].map(name => writeFile(join(harness.outside, name), name)))
  await expect(call('ownerList', { path: harness.outside })).resolves.toMatchObject({
    absolutePath: harness.outside, parentPath: dirname(harness.outside),
    entries: [{ name: 'a' }, { name: 'b' }], truncated: true,
  })
  const root = parse(harness.outside).root
  await expect(call('ownerList', { path: root })).resolves.toMatchObject({ absolutePath: root, parentPath: root })
  await expect(harness.ctx.workspaceFiles.list(harness.scope, harness.outside, signal()))
    .rejects.toMatchObject({ code: 'workspace-file/outside-workspace' })
})

it('round trips complete text outside the workspace without changing sandbox policy', async () => {
  const path = join(harness.outside, 'text')
  const original = '\uFEFFfirst\r\nsecond\r\n'
  await writeFile(path, original)
  const before = await version(path)
  await expect(call('ownerRead', { path })).resolves.toMatchObject({ absolutePath: path, version: before, text: original })
  await expect(call('ownerStat', { path })).resolves.toMatchObject({ absolutePath: path, version: before })
  const write = vi.spyOn(harness.ctx.fs, 'writeText')
  const text = '\uFEFFchanged\r\n'
  const saved = await call('saveText', { path, request: { text, version: before } })
  expect(saved).toMatchObject({ absolutePath: path, version: await version(path), bytes: Buffer.byteLength(text) })
  expect(await readFile(path, 'utf8')).toBe(text)
  expect(write).toHaveBeenCalledWith(expect.anything(), text,
    { kind: 'replaceIfVersion', version: before }, expect.any(AbortSignal),
    { mode: 'danger-full-access', workspaceRoot: path })
  expect(harness.ctx.sandboxPolicy.resolve()).toEqual({ mode: 'workspace-write', workspaceRoot: harness.workspace })
  // The same provider still enforces a read-only agent's next mutation.
  await expect(harness.ctx.fs.writeText(await harness.ctx.fs.resolve(path), 'agent', undefined, signal(),
    { mode: 'read-only', workspaceRoot: harness.workspace })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  expect(await readFile(path, 'utf8')).toBe(text)
})

it.each(['ownerList', 'ownerRead', 'ownerStat', 'saveText'])('refuses %s without owner identity, even with an action grant', async (method) => {
  const path = join(harness.outside, 'private')
  await writeFile(path, 'secret')
  const resolve = vi.spyOn(harness.ctx.fs, 'resolve')
  const args = method === 'saveText' ? { path, request: { text: 'changed', version: 'forged' } } : { path }
  const failure = await call(method, args, guest).catch((error: unknown) => error)
  expect(remoteErrorOf(failure)).toMatchObject({ code: 'workspace-file/owner-required' })
  expect(resolve).not.toHaveBeenCalled()
  expect(await readFile(path, 'utf8')).toBe('secret')
})

it('watches an outside directory for the owner and refuses a granted non-owner stream', async () => {
  const controller = new AbortController()
  const source = await harness.ctx.typertGateway.stream({
    peer: owner, namespace: 'workspaceFiles', method: 'ownerChanges',
    args: { path: harness.outside }, signal: controller.signal,
  })
  const iterator = source[Symbol.asyncIterator]()
  try {
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { kind: 'ready' } })
  } finally {
    controller.abort()
    await iterator.return?.()
  }
  const refused = async () => {
    const stream = await harness.ctx.typertGateway.stream({
      peer: guest, namespace: 'workspaceFiles', method: 'ownerChanges', args: { path: harness.outside },
    })
    await stream[Symbol.asyncIterator]().next()
  }
  await expect(refused()).rejects.toMatchObject({ code: 'workspace-file/owner-required' })
})

it('refuses direct calls without an invocation, including a forged Session scope', async () => {
  const service = harness.ctx.workspaceFiles
  await expect(service.ownerRead(harness.outside, signal())).rejects.toMatchObject({ code: 'workspace-file/owner-required' })
  await expect(service.saveText(harness.outside, { text: 'x', version: harness.scope.sessionId }, signal()))
    .rejects.toMatchObject({ code: 'workspace-file/owner-required' })
  expect(() => service.ownerChanges(harness.outside, signal())).toThrow('Authenticated owner access is required')
})

it('rejects changed and deleted files without replacing or recreating them', async () => {
  const path = join(harness.outside, 'text')
  await writeFile(path, 'initial')
  const before = await version(path)
  await writeFile(path, 'external')
  await expect(call('saveText', { path, request: { text: 'mine', version: before } }))
    .rejects.toMatchObject({ code: 'workspace-file/conflict' })
  expect(await readFile(path, 'utf8')).toBe('external')
  await unlink(path)
  await expect(call('saveText', { path, request: { text: 'mine', version: before } }))
    .rejects.toMatchObject({ code: 'workspace-file/conflict' })
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('allows only one concurrent save at the same loaded version', async () => {
  const path = join(harness.outside, 'text')
  await writeFile(path, 'initial')
  const before = await version(path)
  const results = await Promise.allSettled(['first', 'second'].map(text =>
    call('saveText', { path, request: { text, version: before } })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(result => result.status === 'rejected')
  expect(rejected?.status === 'rejected' ? remoteErrorOf(rejected.reason) : undefined)
    .toMatchObject({ code: 'workspace-file/conflict' })
})

it('rejects changes during a complete read and during save preflight', async () => {
  const path = join(harness.outside, 'text')
  await writeFile(path, 'initial')
  const read = harness.ctx.fs.readBytes.bind(harness.ctx.fs)
  vi.spyOn(harness.ctx.fs, 'readBytes').mockImplementation(async (...args) => {
    const bytes = await read(...args)
    await writeFile(path, 'external mutation')
    return bytes
  })
  await expect(call('ownerRead', { path })).rejects.toMatchObject({ code: 'workspace-file/conflict' })
  const before = await version(path)
  await expect(call('saveText', { path, request: { text: 'mine', version: before } }))
    .rejects.toMatchObject({ code: 'workspace-file/conflict' })
  expect(await readFile(path, 'utf8')).toBe('external mutation')
})

it.each([Buffer.from([0, 1]), Buffer.from([0xff, 0xfe])])('refuses binary input for both editing and replacement', async (bytes) => {
  const path = join(harness.outside, 'binary')
  await writeFile(path, bytes)
  await expect(call('ownerRead', { path })).rejects.toMatchObject({ code: 'workspace-file/not-text' })
  await expect(call('saveText', { path, request: { text: 'overwrite', version: await version(path) } }))
    .rejects.toMatchObject({ code: 'workspace-file/not-text' })
  expect(await readFile(path)).toEqual(bytes)
})

it.each(['bad\0text', '\ud800'])('refuses non-text replacement %j', async (text) => {
  const path = join(harness.outside, 'text')
  await writeFile(path, 'initial')
  await expect(call('saveText', { path, request: { text, version: await version(path) } }))
    .rejects.toMatchObject({ code: 'workspace-file/not-text' })
  expect(await readFile(path, 'utf8')).toBe('initial')
})

it('enforces the full-file byte cap on reads and saves', async () => {
  const path = join(harness.outside, 'text')
  await writeFile(path, 'x'.repeat(129))
  await expect(call('ownerRead', { path })).rejects.toMatchObject({ code: 'workspace-file/too-large' })
  await writeFile(path, 'initial')
  await expect(call('saveText', { path, request: { text: '字'.repeat(43), version: await version(path) } }))
    .rejects.toMatchObject({ code: 'workspace-file/too-large' })
  await expect(call('saveText', { path, request: { text: 'x'.repeat(128), version: await version(path) } }))
    .resolves.toMatchObject({ bytes: 128 })
})

it('refuses relative paths, missing versions and final file symlinks', async () => {
  await expect(call('ownerList', { path: '..' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
  const path = join(harness.outside, 'text')
  await writeFile(path, 'initial')
  await expect(call('saveText', { path, request: { text: 'mine', version: '' } }))
    .rejects.toMatchObject({ code: 'gateway/bad-request' })
  const link = join(harness.outside, 'link')
  await symlink(path, link)
  await expect(call('ownerRead', { path: link })).rejects.toMatchObject({ code: 'workspace-file/not-regular-file' })
  await expect(call('saveText', { path: link, request: { text: 'mine', version: await version(path) } }))
    .rejects.toMatchObject({ code: 'workspace-file/not-regular-file' })
})

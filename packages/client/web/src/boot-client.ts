/**
 * Production client composition without the page: mount the Loader over a
 * module system, create every manifest row, wait for quiescence, and report
 * the rows that did not activate. The shell decides which of those failures it
 * can present an application without.
 * @module @deepseek-ai/dsh-client-web/src/boot-client
 */
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { BootManifest, ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { STATE_LABELS } from './loader-status.ts'

/** Entry state label as the boot page renders it. */
export type EntryStateLabel = (typeof STATE_LABELS)[keyof typeof STATE_LABELS] | 'loading' | 'failed'

/** One client row that did not reach `active`, with the cause the boot chain reports. */
export interface ClientBootFailure {
  /** Loader entry name; a client entry name equals its package name. */
  readonly id: string
  /** Why the row is not active: import error, missing service, or fiber state. */
  readonly reason: string
}

/**
 * Entry ids without which the shell cannot present an application at all: the
 * Host connection, the layout that contributes `root`, and the renderer that
 * owns the React root. Every other row degrades to a boot notice.
 */
export const REQUIRED_CLIENT_ENTRY_IDS: ReadonlySet<string> = new Set(['connection', 'ui-layout', 'ui-renderer'])

/** Inputs of {@link bootClient}. */
export interface ClientBootOptions {
  /** Fresh root Context that will own the plugin tree. */
  readonly ctx: Context
  /** Module system installed as `loader.internal`. */
  readonly modules: ClientModuleLoader
  /** Parsed manifest whose `plugins` rows become Loader entries (entry name = row id). */
  readonly manifest: BootManifest
  /** Per-entry state reporting (the boot page); omitted when no one renders progress. */
  readonly onEntryState?: (name: string, state: EntryStateLabel) => void
}

/**
 * Compose the client: `ctx.plugin(Loader)`, `loader.internal = modules`, one
 * `loader.create({ name })` per manifest row, then `loader.await()`. A row
 * whose module cannot be imported is marked failed, its import error is
 * recorded by the module system, and its consumers stay `pending` on the
 * services it would have provided; both are reported so the caller can decide
 * whether the application can still be presented.
 * @param options - context, module system, manifest, optional progress sink.
 * @returns every row that is not active, in Loader order.
 */
export async function bootClient(options: ClientBootOptions): Promise<ClientBootFailure[]> {
  const { ctx, manifest, onEntryState } = options
  await ctx.plugin(Loader)
  const loader = ctx.loader
  loader.internal = options.modules as never

  ctx.on('internal/status', (fiber) => {
    const entry = fiber.entry
    if (entry === undefined || entry.fiber === undefined) return
    onEntryState?.(entry.options.name, STATE_LABELS[entry.fiber.state])
  })

  const rows = manifest.plugins.map(row => row.id)
  for (const name of rows) onEntryState?.(name, 'loading')
  await options.modules.entries.start(loader, manifest)
  for (const entry of loader.entries()) {
    if (entry.fiber === undefined) onEntryState?.(entry.options.name, 'failed')
  }

  await loader.await()
  return auditEntries(ctx, options.modules)
}

/**
 * Report entries that failed import or apply, or still wait on missing
 * services. The module system names the transport, registration, or factory
 * error behind an entry with no fiber.
 * @param ctx - root Context carrying the Loader.
 * @param modules - the module system whose recorded import failures name why an entry
 *   has no fiber; a row with no record points at the console.
 * @returns one failure per non-active entry, in Loader order.
 */
export function auditEntries(ctx: Context, modules: Pick<ClientModuleLoader, 'importError'>): ClientBootFailure[] {
  const failures: ClientBootFailure[] = []
  for (const entry of ctx.loader.entries()) {
    const id = entry.options.name
    if (entry.fiber === undefined) {
      const importError = modules.importError(id)
      failures.push({
        id,
        reason: importError === undefined
          ? 'import failed (see console for the import error)'
          : `import failed: ${importError.message}`,
      })
      continue
    }
    const state = STATE_LABELS[entry.fiber.state]
    if (state === 'active') continue
    if (state === 'pending') {
      const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
      failures.push({ id, reason: `pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})` })
    } else {
      failures.push({ id, reason: state })
    }
  }
  return failures
}

/**
 * Select the failures that keep the application from being presented.
 * @param failures - every non-active entry reported by {@link bootClient}.
 * @returns only the failures whose entry id is in {@link REQUIRED_CLIENT_ENTRY_IDS}.
 */
export function fatalFailures(failures: readonly ClientBootFailure[]): ClientBootFailure[] {
  return failures.filter(failure => REQUIRED_CLIENT_ENTRY_IDS.has(failure.id))
}

/**
 * Render the startup report for failures the shell cannot run without.
 * @param binName - diagnostic prefix, matching the Host startup text.
 * @param failures - required entries that did not activate.
 * @returns one report block naming each failure.
 */
export function requiredFailureReport(binName: string, failures: readonly ClientBootFailure[]): string {
  const noun = failures.length === 1 ? 'entry' : 'entries'
  return `${binName}: startup failed: ${String(failures.length)} required ${noun} did not activate\n`
    + failures.map(failure => `${failure.id}: ${failure.reason}`).join('\n')
}

/**
 * Deferred-row roster: the explicit list of client rows the Host may compose
 * as lazy. Nothing is deferred implicitly — a row becomes lazy only because
 * this roster names it (or because its own `dsh.client.deferred` declaration
 * asks for it), and never when it is bootstrap infrastructure, a stage-one
 * `immediately` row, or a service provider some eager row injects.
 *
 * The operator surface is an environment token list, so changing the roster
 * needs a Host restart, not a rebuild:
 *
 * `DSH_CLIENT_DEFERRED="+dsh-im -@deepseek-ai/dsh-client-ui-schedule"`
 *
 * A bare token defers the package, `-<pkg>` forces it back to eager, and
 * `+<pkg>` spells the add explicitly. Tokens are comma or whitespace separated.
 * @module @deepseek-ai/dsh-client-modules/src/roster
 */

/** One row the roster defers, with the metadata the shell needs to materialize it. */
export interface DeferredRowConfig {
  /** Entry name == package name. */
  readonly id: string
  /** Slot keys the row registers into; the shell renders a skeleton for them until arrival. */
  readonly slots?: readonly string[]
  /** Human-readable description of what materializes the row. */
  readonly trigger?: string
}

/**
 * The shipped default roster: the panels and surfaces that are only reachable
 * by opening a panel, running a command, or opening a settings route, so their
 * bytes are first-paint waste. Sizes are the measured unminified bundles from
 * the 2026-11-22 first-load audit (see the package README).
 */
export const DEFAULT_DEFERRED_ROWS: readonly DeferredRowConfig[] = [
  // Panels reached by opening the sidebar panel list.
  { id: 'dsh-im', slots: ['sidebar.panellist'], trigger: 'slot:sidebar.panellist' },
  { id: '@deepseek-ai/dsh-client-ui-schedule', slots: ['sidebar.panellist'], trigger: 'slot:sidebar.panellist' },
  { id: '@deepseek-ai/dsh-client-ui-plugin-manager', slots: ['sidebar.panellist'], trigger: 'slot:sidebar.panellist' },
  // Right-sidebar tabs and tool views.
  { id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview', slots: ['sidebar.right.pane.tab'], trigger: 'slot:sidebar.right.pane.tab' },
  { id: '@deepseek-ai/dsh-client-ui-deliverables', slots: ['sidebar.right.pane.tab', 'tool.call.toolview'], trigger: 'slot:sidebar.right.pane.tab' },
  { id: '@deepseek-ai/dsh-client-ui-workflow-run', slots: ['conversation.chat.node'], trigger: 'slot:conversation.chat.node' },
  // Settings sections, reached by opening Settings.
  { id: '@deepseek-ai/dsh-client-ui-settings-account', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-agent-loop', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-general', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-models', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-plugins', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-session-log', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-subagent', slots: ['settings.section'], trigger: 'slot:settings.section' },
  { id: '@deepseek-ai/dsh-client-ui-settings-web-search', slots: ['settings.section'], trigger: 'slot:settings.section' },
  // Profile-installed plugins with panel or tool surfaces; an operator adds the
  // exact slot keys here when a plugin owns none of the shipped hints.
  { id: 'dsh-split-panels', slots: ['shell.overlay'], trigger: 'slot:shell.overlay' },
  { id: 'dsh-plantuml', slots: ['conversation.chat.node'], trigger: 'slot:conversation.chat.node' },
]

/** Environment variable carrying the operator's roster tokens. */
export const DEFERRED_ROSTER_ENV = 'DSH_CLIENT_DEFERRED'

/** Resolved deferral metadata for one row. */
export interface DeferredRowHint {
  /** Slot keys the row registers into. */
  readonly slots: readonly string[]
  /** Description of the row's materialization trigger. */
  readonly trigger?: string
}

/** A configured roster after operator tokens: what to defer and what an operator forced eager. */
export interface ResolvedDeferredRoster {
  /** Package name → deferral metadata. */
  readonly rows: ReadonlyMap<string, DeferredRowHint>
  /** Packages an operator forced back to eager (`-<pkg>`); a veto over the roster and over declarations. */
  readonly removed: ReadonlySet<string>
}

/**
 * Merge the configured roster with operator tokens.
 * @param configured - the roster the Host composes with (the shipped default unless configured).
 * @param tokens - raw operator token string, `undefined`/empty for none.
 * @returns the resolved roster and the explicit eager vetoes.
 */
export function resolveDeferredRoster(
  configured: readonly DeferredRowConfig[],
  tokens?: string,
): ResolvedDeferredRoster {
  const rows = new Map<string, DeferredRowHint>()
  const removed = new Set<string>()
  for (const row of configured) {
    rows.set(row.id, {
      slots: [...row.slots ?? []],
      ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
    })
  }
  for (const raw of tokens?.split(/[\s,]+/) ?? []) {
    const token = raw.trim()
    if (token === '' || token === '+' || token === '-') continue
    if (token.startsWith('-')) {
      const id = token.slice(1)
      rows.delete(id)
      removed.add(id)
      continue
    }
    const id = token.startsWith('+') ? token.slice(1) : token
    removed.delete(id)
    const existing = rows.get(id)
    rows.set(id, existing ?? { slots: [] })
  }
  return { rows, removed }
}

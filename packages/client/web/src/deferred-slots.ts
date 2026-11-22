/**
 * Deferred-row slot bridge. The Host composes some client rows as deferred
 * (`lazy`): their bundles are in no initial batch and boot creates no Loader
 * entry for them. Each such row publishes the slot keys its registration will
 * fill, and this bridge turns that roster into slot deferral hints:
 *
 * - the outlet that renders the slot while it has no contribution shows a
 *   skeleton and runs the first-need trigger (`activateDeferred`), which is
 *   what makes the trigger "first time it is needed";
 * - a failed activation replaces the skeleton with the entry's failure text
 *   (the same wording the boot audit uses), so a deferred panel never renders
 *   as a silent blank;
 * - a row that materializes drops its hints, and the real registration renders
 *   through the ordinary dispatch path.
 *
 * The bridge runs between boot and mount, so the very first frame already
 * knows which empty cells are loading rather than absent.
 * @module @deepseek-ai/dsh-client-web/src/deferred-slots
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ClientModuleLoader, DeferredEntryInfo } from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/**
 * Install deferral hints for every deferred row the module system publishes,
 * keeping them in step with row phases and graph updates.
 * @param ctx - booted root Context (the `slots` registry installs with the UI renderer).
 * @param modules - the page module system that owns deferred rows.
 * @returns resolves once the `slots` service exists and the hints are installed.
 */
export async function installDeferredSlots(ctx: Context, modules: ClientModuleLoader): Promise<void> {
  await ctx.inject(['slots'], (scope) => {
    const slots = scope.slots
    /** Entry id → hint disposers, so re-declaration stays per-row. */
    const live = new Map<string, (() => void)[]>()
    const release = (id: string): void => {
      for (const dispose of live.get(id) ?? []) dispose()
      live.delete(id)
    }
    const sync = (): void => {
      const rows = new Map<string, DeferredEntryInfo>(modules.deferredEntries().map(row => [row.id, row]))
      for (const id of [...live.keys()]) {
        const status = modules.deferredStatus(id)
        if (rows.has(id) && status?.phase !== 'ready') continue
        release(id)
      }
      for (const row of rows.values()) {
        const status = modules.deferredStatus(row.id)
        if (status?.phase === 'ready') continue
        if (!live.has(row.id)) {
          live.set(row.id, row.slots.map(key => slots.deferSlot({
            key,
            entry: row.id,
            ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
            activate: () => {
              // The phase channel owns the failure presentation; swallowing the
              // rejection here keeps a broken plugin out of the trigger path.
              void modules.activateDeferred(row.id).catch((_failure: unknown) => undefined)
            },
          })))
        }
        if (status !== undefined) slots.setDeferredPhase(row.id, status.phase, status.message)
      }
    }
    scope.effect(() => {
      sync()
      const off = modules.onDeferredChange(() => { sync() })
      return () => {
        off()
        for (const id of [...live.keys()]) release(id)
      }
    }, 'web boot: deferred slot hints')
  })
}

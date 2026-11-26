/**
 * Decide whether a Session-replacing model switch must be refused because the
 * source composer still holds a draft or runtime attachments.
 *
 * A cross-engine switch opens a different Session. The Composer's draft
 * attachments are runtime identities bound to the source upload/session owner,
 * and the persisted draft snapshot does not contain them, so this plugin cannot
 * faithfully re-bind them. Instead of silently losing them, the switch is
 * blocked and the source Session keeps its draft and attachments.
 */

/** The parts of the Composer input state this guard reads. */
export interface DraftSwitchState {
  readonly draft?: unknown
  readonly attachmentIds?: unknown
}

/**
 * Whether a switch would discard draft content.
 * @param state - the source Composer's input-state snapshot, of unknown shape.
 * @returns true when text or attachment ids are present.
 */
export function draftBlocksSwitch(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false
  const record = state as DraftSwitchState
  if (typeof record.draft === 'string' && record.draft.trim() !== '') return true
  for (const key of ['attachmentIds', 'attachments', 'images'] as const) {
    const value = (record as Record<string, unknown>)[key]
    if (Array.isArray(value) && value.length > 0) return true
  }
  return false
}

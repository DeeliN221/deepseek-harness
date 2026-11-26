/**
 * Composer-draft hand-off for the Session switch a model change performs.
 *
 * A cross-engine model selection makes the Host create a new Session and the
 * selector opens it through workspace navigation. The Composer restores a
 * Session's draft from browser storage when its input shell is first created,
 * so writing the current draft under the target Session's key BEFORE navigation
 * is what makes it reappear there — no Composer plugin API and no event wiring.
 *
 * The payload is copied verbatim (references, quotes and any forward-compatible
 * attachment ids included), which keeps the semantic document intact for the
 * same parser the Composer uses on mount. Attachment ids are opaque runtime
 * identities owned by the Composer: this hand-off preserves the payload and
 * never overwrites a target that already holds text or attachments, but it does
 * not claim to re-create the runtime attachments themselves.
 * Every failure is swallowed: a missing draft must never block the switch.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Persistence key the Conversation store uses, suffixed with the Session id. */
const DRAFT_STORE_KEY = 'dsh.conversation'

/** One Session's persisted Conversation store payload. */
type PersistedConversation = Record<string, unknown>

/**
 * Hand the current Session's persisted draft to the Session being opened.
 *
 * The draft is only written when the source carries content and the target
 * holds none, so no existing text is ever overwritten and a repeated switch
 * cannot duplicate work onto a Session that already has its own draft.
 * @param from - Session whose draft is handed over.
 * @param to - Session about to be opened.
 */
export function movePersistedDraft(from: SessionId, to: SessionId): void {
  const sourceId = String(from)
  const targetId = String(to)
  if (sourceId === targetId) return
  if (typeof localStorage === 'undefined') return
  try {
    const source = readPersisted(sourceId)
    if (source === undefined || (!carriesDraft(source.draft) && !hasAttachments(source))) return
    const target = readPersisted(targetId) ?? {}
    // A target that already holds text or attachments (including pure-image
    // drafts) must never be overwritten by the hand-off.
    if (carriesDraft(target.draft) || hasAttachments(target)) return
    localStorage.setItem(`${DRAFT_STORE_KEY}.${targetId}`, JSON.stringify({ ...target, draft: source.draft }))
  } catch (_error: unknown) {
    // Unavailable storage (quota, private mode, malformed JSON) leaves the target draft empty.
  }
}

/**
 * Read one Session's persisted Conversation store payload.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns the decoded payload, or undefined when absent or unreadable.
 */
function readPersisted(sessionId: string): PersistedConversation | undefined {
  const raw = localStorage.getItem(`${DRAFT_STORE_KEY}.${sessionId}`)
  if (raw === null) return undefined
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as PersistedConversation
}

/**
 * Whether a persisted draft holds anything worth handing over.
 * Accepts the semantic snapshot and the earlier plain-string representation.
 * @param draft - persisted draft value, of any shape.
 * @returns true when the draft has text, chips, quotes, or a command token.
 */
function carriesDraft(draft: unknown): boolean {
  if (typeof draft === 'string') return draft.trim() !== ''
  if (typeof draft !== 'object' || draft === null) return false
  const snapshot = draft as { text?: unknown; references?: unknown; quotes?: unknown; command?: unknown }
  if (typeof snapshot.text === 'string' && snapshot.text.trim() !== '') return true
  if (Array.isArray(snapshot.references) && snapshot.references.length > 0) return true
  if (Array.isArray(snapshot.quotes) && snapshot.quotes.length > 0) return true
  if (typeof snapshot.command === 'object' && snapshot.command !== null) return true
  return hasAttachments(snapshot)
}

/** Attachment-bearing drafts (pure-image included) count as content worth preserving. */
function hasAttachments(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  for (const key of ['attachmentIds', 'attachments', 'images', 'files']) {
    const list = record[key]
    if (Array.isArray(list) && list.length > 0) return true
  }
  return false
}

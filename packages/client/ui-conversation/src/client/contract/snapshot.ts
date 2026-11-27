/** Target-neutral Conversation state assembled from one Session event window. */
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationViewSnapshotStore } from './conversation.ts'

/** Reader-controlled local materialization window over an already loaded Session event window. */
export interface ConversationHistoryWindow {
  /** Changes whenever a local page changes the materialized floor. */
  readonly revision: number
  /** Whether older loaded Contexts remain hidden behind the local floor. */
  readonly pending: boolean
  /** Materialize one older local page, returning false when the local window is complete. */
  expandOlder(): boolean
  /** Reveal one older local page only when the matching Turn start is already loaded. */
  revealThrough(turn: number, seq: number): boolean
}

/** Latest registered target snapshots and their shell-level activity. */
export interface ConversationSnapshot {
  readonly views: ConversationViewSnapshotStore
  readonly activeTargets: ReadonlySet<string>
  readonly historyWindow?: ConversationHistoryWindow
  /** History pages incorporated into the published target snapshots since the last replacement. */
  readonly historyPageIds?: readonly number[]
}

const EMPTY_HISTORY_WINDOW: ConversationHistoryWindow = {
  revision: 0,
  pending: false,
  expandOlder: () => false,
  revealThrough: () => false,
}

/** Empty Conversation value used before a Session binding is available. */
export const EMPTY_CONVERSATION_SNAPSHOT: ConversationSnapshot = {
  views: { get: () => undefined, grouped: () => undefined },
  activeTargets: new Set(),
  historyWindow: EMPTY_HISTORY_WINDOW,
  historyPageIds: [],
}

/** Shell phase derived from Session lifecycle and registered target activity. */
export type ConversationPhase = 'blank' | 'engaging' | 'active'

/**
 * Resolve the shell phase without adding Conversation data to the Session snapshot.
 * @param session - current Session lifecycle state.
 * @param conversation - current target-neutral Conversation state.
 * @returns the phase used by the header, View ring, and composer layout.
 */
export function conversationPhase(
  session: SessionSnapshot,
  conversation: ConversationSnapshot,
): ConversationPhase {
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  return active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
}

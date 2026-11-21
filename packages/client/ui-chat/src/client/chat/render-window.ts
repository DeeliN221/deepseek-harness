/** Bounded projection of the loaded Chat order into the transcript renderer. */

export const CHAT_RENDER_WINDOW_NODES = 240

/** Half-open bounds into the complete loaded Chat order. */
export interface ChatRenderWindowBounds {
  readonly start: number
  readonly end: number
}

/** Stable keys retained while a reader is away from the tail. */
export interface ChatRenderWindowAnchor {
  readonly sessionId: string
  readonly firstKey: string
  readonly lastKey: string
}

/** Return the newest suffix that fits the transcript node budget. */
export function tailRenderWindow(length: number, limit = CHAT_RENDER_WINDOW_NODES): ChatRenderWindowBounds {
  const end = Math.max(0, length)
  const start = Math.max(0, end - Math.max(1, limit))
  return { start, end }
}

/** Return a bounded range with the selected index at the requested offset. */
export function anchoredRenderWindow(
  length: number,
  anchorIndex: number,
  limit = CHAT_RENDER_WINDOW_NODES,
  anchorOffset = Math.floor(limit / 2),
): ChatRenderWindowBounds {
  const size = Math.max(1, limit)
  const endOfOrder = Math.max(0, length)
  if (endOfOrder === 0) return { start: 0, end: 0 }
  const target = Math.min(endOfOrder - 1, Math.max(0, anchorIndex))
  const offset = Math.min(size - 1, Math.max(0, anchorOffset))
  const start = Math.min(Math.max(0, target - offset), Math.max(0, endOfOrder - size))
  return { start, end: Math.min(endOfOrder, start + size) }
}

/** Resolve a stable keyed window, falling back to the tail after replacement. */
export function resolveRenderWindow(
  order: readonly string[],
  sessionId: string,
  anchor: ChatRenderWindowAnchor | null,
  limit = CHAT_RENDER_WINDOW_NODES,
): ChatRenderWindowBounds {
  if (order.length <= limit) return tailRenderWindow(order.length, limit)
  if (anchor === null || anchor.sessionId !== sessionId) return tailRenderWindow(order.length, limit)
  const start = order.indexOf(anchor.firstKey)
  const last = order.indexOf(anchor.lastKey)
  if (start < 0 || last < start) return tailRenderWindow(order.length, limit)
  const end = Math.min(last + 1, start + Math.max(1, limit), order.length)
  return end > start ? { start, end } : tailRenderWindow(order.length, limit)
}

/** Capture the keys at the current range edges for stable prepend and append behavior. */
export function renderWindowAnchor(
  order: readonly string[],
  sessionId: string,
  bounds: ChatRenderWindowBounds,
): ChatRenderWindowAnchor | null {
  const firstKey = order[bounds.start]
  const lastKey = order[bounds.end - 1]
  return firstKey === undefined || lastKey === undefined ? null : { sessionId, firstKey, lastKey }
}

/** Move the window toward older loaded rows while retaining its previous head as an anchor. */
export function earlierRenderWindow(
  length: number,
  current: ChatRenderWindowBounds,
  limit = CHAT_RENDER_WINDOW_NODES,
): ChatRenderWindowBounds | null {
  if (current.start <= 0) return null
  return anchoredRenderWindow(length, current.start, limit, Math.floor(limit * 0.75))
}

/** Move a bounded local slice toward newer rows without declaring the global tail followed. */
export function laterRenderWindow(
  length: number,
  current: ChatRenderWindowBounds,
  limit = CHAT_RENDER_WINDOW_NODES,
): ChatRenderWindowBounds | null {
  if (current.end >= length) return null
  const nextStart = Math.min(current.start + Math.max(1, Math.floor(limit / 4)), Math.max(0, length - limit))
  if (nextStart <= current.start) return null
  return { start: nextStart, end: Math.min(length, nextStart + Math.max(1, limit)) }
}

/** Resolve a stored row or split-node anchor into the complete Chat order. */
export function savedAnchorIndex(order: readonly string[], anchorKey: string): number {
  const exact = order.indexOf(anchorKey)
  if (exact >= 0 || !anchorKey.startsWith('[')) return exact
  try {
    const parts: unknown = JSON.parse(anchorKey)
    return Array.isArray(parts) && typeof parts[0] === 'string' ? order.indexOf(parts[0]) : -1
  } catch {
    return -1
  }
}

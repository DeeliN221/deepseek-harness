/** Web opening aggregation over one observation and a shared transforming buffer. */

import type { Context } from '@deepseek-ai/cordis'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import { remoteErrorOf, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { HistoryController } from '../history/controller.ts'
import { addressId, rejectNotFound } from '../history.ts'
import { EventListener, ListenerBuffer } from '../history/listener.ts'
import { history, projections, resolveHistoryRequest, validateObservationAddress } from '../history/controller.ts'
import { pageRecords } from '../history.ts'
import { DEFAULT_FOLLOW_WINDOW } from '../types.ts'
import type {
  SessionFollowFrame, SessionFollowRequest, SessionFollowWindow, SessionHistoryRecord, SessionPageRequest,
} from '../types.ts'

/**
 * Merge the deployment opening window with a follow request's explicit fields.
 * @param request - follow request whose window fields override the Host policy.
 * @param window - resolved Host opening window.
 * @returns one page request carrying the effective opening window.
 */
function openingRequest(request: SessionFollowRequest, window: SessionFollowWindow): SessionPageRequest {
  const maxMessages = request.maxMessages ?? window.maxMessages
  return {
    address: request.address,
    maxEvents: request.maxEvents ?? window.maxEvents,
    maxMessages,
    // An explicit Turn window is validated as supplied. Only the Host default
    // is clamped: a caller that shrinks maxMessages alone must not inherit a
    // default Turn minimum above its own ceiling.
    turnWindow: request.turnWindow ?? {
      ...window.turnWindow,
      minMessages: Math.min(window.turnWindow.minMessages, maxMessages),
    },
  }
}

/**
 * Replay just the events after `afterSeq` when the caller's window can absorb them.
 * @param observation - exact read the opening is built from.
 * @param afterSeq - highest event seq the caller already applied.
 * @param maxEvents - event ceiling of the opening window.
 * @returns the delta records, or undefined when the caller needs a full window.
 */
function resumableRecords(
  observation: SessionObservation,
  afterSeq: number,
  maxEvents: number,
): readonly SessionHistoryRecord[] | undefined {
  if (afterSeq > observation.cursor) return undefined
  if (observation.cursor - afterSeq > maxEvents) return undefined
  const events = observation.events.slice(afterSeq + 1, observation.cursor + 1)
  // A replacement shadows earlier surface content, and an event citing earlier
  // sources needs those sources to be interpreted. Neither can be replayed as a
  // plain append over the caller's window, so the caller gets a fresh window.
  if (events.some(event => isReplacementSurfaceEvent(event) || event.sourceEventSeqs !== undefined)) {
    return undefined
  }
  return pageRecords(events)
}

/** Combines opening data and consumes transformed listener output from one queue. */
export class WebController {

  /**
   * @param ctx - Host context carrying Session queries and identity projections.
   * @param historyController - passive reading and listener construction.
   * @param promote - background activation requested before an opening snapshot is delivered.
   * @param openingWindow - Host opening history window; request fields override it per field.
   */
  constructor(
    private readonly ctx: Context,
    private readonly historyController: HistoryController,
    private readonly promote: (observation: SessionObservation) => void,
    private readonly openingWindow: SessionFollowWindow = DEFAULT_FOLLOW_WINDOW,
  ) {}

  /**
   * Open a history snapshot and follow uncovered history and assistant notifications.
   * @param request - Session identity, page budget, assistant output and optional activation (default false).
   * @param signal - cancellation for opening and streaming.
   * @returns an opening snapshot followed by uncovered queued increments.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const sessionId = addressId(request.address)
    const spec = resolveHistoryRequest(openingRequest(request, this.openingWindow))
    const afterSeq = request.afterSeq
    if (afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < 0)) {
      throw new RemoteError('gateway/bad-request', 'afterSeq must be a non-negative safe integer', {})
    }
    using queue = new ListenerBuffer<SessionFollowFrame>(this.ctx, signal)
    using listener = new EventListener(this.ctx, sessionId, signal, queue)
    const streams = this.historyController.streamsListener
    using assistantListener = request.assistantStream === true
      ? streams.bind(sessionId, signal, queue)
      : undefined
    using observation = await this.historyController.usingObservation({ sessionId, projection: true }, signal)
      .catch((error: unknown) => {
        if (remoteErrorOf(error)?.code === 'session/not-found') rejectNotFound(request.address)
        throw error
      })
    validateObservationAddress(request.address, observation)
    const header = { ...observation.header }
    const projectionBaseline = projections(observation)
    let opening: SessionFollowFrame
    if (afterSeq === undefined) {
      opening = {
        type: 'snapshot',
        header,
        projections: projectionBaseline,
        ...history(observation, spec),
      }
    } else {
      const resumed = resumableRecords(observation, afterSeq, spec.maxEvents)
      opening = resumed === undefined
        ? {
          type: 'snapshot',
          header,
          projections: projectionBaseline,
          ...history(observation, spec),
          reset: true,
        }
        : {
          type: 'snapshot',
          header,
          projections: projectionBaseline,
          cursor: observation.cursor,
          records: resumed,
          hasMore: afterSeq > 0,
          resumed: true,
        }
    }
    listener.setCursor(opening.cursor)
    if (assistantListener !== undefined) {
      const { baseline: assistantStream, ordinal } = assistantListener.snapshot()
      opening = { ...opening, assistantStream }
      assistantListener.setOrdinalCut(ordinal)
    }
    // Increments come from the queue, so the opening ends this lease in every branch;
    // activation continues on its own retained lease. Promotion starts before the opening is
    // delivered, so a consumer that stops after the snapshot still gets the activation it asked for.
    if (request.activate === true && !signal.aborted
      && observation.header.origin !== 'subagent' && observation.source === 'prepared') {
      const promotion = observation.retain()
      observation[Symbol.dispose]()
      try {
        this.promote(promotion)
      } catch (error: unknown) {
        promotion[Symbol.dispose]()
        throw error
      }
    } else {
      observation[Symbol.dispose]()
    }
    yield opening
    yield* queue.items()
  }
}

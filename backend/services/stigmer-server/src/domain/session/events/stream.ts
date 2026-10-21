/**
 * SessionQueryController.streamEvents: a session's events as they are
 * appended, and the previews the stream asked for.
 *
 * The stream is a cursor over the stored log. It keeps one position, the
 * last seq it sent, and its loop does one thing: read the store after that
 * seq, send, advance. With `after_seq` it starts there (a resume); without,
 * it starts after the newest stored event, read once the subscription has
 * registered, so it sends nothing from before it opened, as Managed Agents'
 * does. Every later append is numbered above that position, so none is
 * missed, and because the position only moves forward none is sent twice.
 *
 * Between reads it waits for one of three things: the client leaving, the
 * broker's bell (an append on this server committed, broker.ts), or the
 * tail timer, which finds what another server process committed: the
 * rolling update's overlap, when the outgoing and the incoming server serve
 * together and a watcher's stream is on the other one. The tail read runs
 * `SESSION_EVENT_TAIL_MIN_MS` after the last delivered event, doubling up to
 * `SESSION_EVENT_TAIL_MAX_MS` while reads find nothing; an idle tab costs
 * one indexed read per interval. Queued previews are sent before each read:
 * an append publishes its previews before its events (append.ts), so their
 * relative order holds.
 *
 * Nothing per watcher is held in server memory but its bounded previews,
 * so a slow reader is never ended: it reads when it is ready, as a resume
 * does. The stream stays open for the client's lifetime (a session always
 * takes another turn), ending when the client leaves, or with UNAVAILABLE
 * when the server starts to leave (the broker closes), which a client
 * answers by streaming again with the last seq it has.
 *
 * A direct handler (ConnectRPC server streams are async generators,
 * which cannot yield from inside the pipeline): an
 * authorizeDirect of the method's annotation (can_view on the session) at
 * the start, before the subscription is registered, and again before the
 * next frame once SESSION_EVENT_STREAM_REAUTHORIZE_MS has passed, so a
 * viewer whose access is withdrawn stops receiving events.
 *
 * Proven by __tests__/broker.test.ts and the session-events and long-turn
 * conformance suites.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";

import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsRequest,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import type { Logger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { internalError, invalidArgumentError } from "../../../pipeline/errors.js";
import { callerIdentityOf } from "../../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../../pipeline/steps/authorize.js";
import type { Store } from "../../../store/interface.js";
import type { SessionEventQuery, SessionEventRecord } from "../../../store/session-events.js";
import { SESSION_EVENT_BROKER_CLOSED_MESSAGE, type SessionEventBroker } from "./broker.js";
import { eventOf } from "./codec.js";

export interface StreamSessionEventsDeps {
  /** Where the stream reads the events after its cursor. */
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly sessionEventBroker: SessionEventBroker;
  /** Unix milliseconds; injectable for the re-authorization arm. */
  readonly now?: () => number;
  /** The tail read's bounds; injectable for the arms that would wait on them. */
  readonly tailMs?: { readonly min: number; readonly max: number };
}

/**
 * How long a stream serves on one authorization. A stream has no end of its
 * own (a session always takes another turn), so a viewer whose access is
 * withdrawn (a share revoked, a member removed) would keep receiving
 * events for as long as the connection lived: past this, the next frame
 * waits for the method's check again, and a refusal ends the stream with it.
 */
export const SESSION_EVENT_STREAM_REAUTHORIZE_MS = 5 * 60 * 1000;

/** How many stored events the stream reads per round trip. */
export const SESSION_EVENT_REPLAY_BATCH = 100;

/** The tail read's first interval after a delivered event. */
export const SESSION_EVENT_TAIL_MIN_MS = 15_000;

/** The tail read's longest interval, reached while reads keep finding nothing. */
export const SESSION_EVENT_TAIL_MAX_MS = 2 * 60_000;

export async function* streamSessionEvents(
  deps: StreamSessionEventsDeps,
  req: StreamSessionEventsRequest,
  context: HandlerContext,
): AsyncGenerator<StreamSessionEventsResponse> {
  if (req.sessionId === "") {
    throw invalidArgumentError("session_id is required");
  }
  const now = deps.now ?? Date.now;
  const tail = deps.tailMs ?? { min: SESSION_EVENT_TAIL_MIN_MS, max: SESSION_EVENT_TAIL_MAX_MS };
  const authorize = () =>
    authorizeDirect(SessionQueryController.method.streamEvents, deps.authorizer, callerIdentityOf(context), req);
  await authorize();
  let authorizedAt = now();

  const sessionId = req.sessionId;
  const broker = deps.sessionEventBroker;
  const subscription = broker.subscribe(sessionId, req.eventDeltas);
  const abort = new Promise<void>((resolve) => {
    context.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const reauthorizeWhenDue = async (): Promise<void> => {
    if (now() - authorizedAt >= SESSION_EVENT_STREAM_REAUTHORIZE_MS) {
      await authorize();
      authorizedAt = now();
    }
  };
  const read = async (query: SessionEventQuery): Promise<SessionEventRecord[]> => {
    try {
      return await deps.store.sessionEvents.list(sessionId, query);
    } catch (error) {
      throw internalError(error, "failed to read the session's events");
    }
  };
  const endIfClosed = (): void => {
    if (subscription.closed) {
      throw new ConnectError(subscription.closedBecause ?? SESSION_EVENT_BROKER_CLOSED_MESSAGE, Code.Unavailable);
    }
  };
  try {
    endIfClosed();
    // The cursor, read after the subscription registered (the header says why).
    let sent: number;
    if (req.afterSeq !== undefined) {
      sent = Number(req.afterSeq);
    } else {
      const newest = await read({ order: "desc", limit: 1 });
      sent = newest[0]?.seq ?? 0;
    }
    let tailMs = tail.min;
    // The first read is the resume (or finds nothing); later ones are rung
    // by the bell or fired by the tail timer.
    let readDue = true;
    let tailFired = false;
    while (!context.signal.aborted) {
      endIfClosed();
      let frame = broker.take(subscription);
      while (frame !== undefined) {
        await reauthorizeWhenDue();
        yield frame;
        frame = broker.take(subscription);
      }
      if (subscription.dirty || readDue) {
        subscription.dirty = false;
        readDue = false;
        let delivered = false;
        for (;;) {
          const records = await read({ order: "asc", afterSeq: sent, limit: SESSION_EVENT_REPLAY_BATCH });
          for (const record of records) {
            await reauthorizeWhenDue();
            yield create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: eventOf(record) } });
            sent = record.seq;
            delivered = true;
          }
          if (records.length < SESSION_EVENT_REPLAY_BATCH || context.signal.aborted) {
            break;
          }
          // Previews queued while a long log was read go out between
          // batches, so they trail the events they preview by one batch at
          // most.
          frame = broker.take(subscription);
          while (frame !== undefined) {
            await reauthorizeWhenDue();
            yield frame;
            frame = broker.take(subscription);
          }
        }
        if (delivered) {
          tailMs = tail.min;
        } else if (tailFired) {
          tailMs = Math.min(tailMs * 2, tail.max);
        }
        tailFired = false;
        continue;
      }
      if (subscription.previews.length > 0) {
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        abort,
        new Promise<void>((resolve) => (subscription.notify = resolve)),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            readDue = true;
            tailFired = true;
            resolve();
          }, tailMs);
        }),
      ]);
      clearTimeout(timer);
      subscription.notify = undefined;
    }
  } finally {
    broker.unsubscribe(sessionId, subscription);
  }
}

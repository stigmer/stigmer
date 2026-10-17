/**
 * SessionQueryController.streamEvents: a session's events as they are
 * appended, and the previews the stream asked for.
 *
 * Without `after_seq` the stream starts when it opens and sends nothing
 * from before, as Managed Agents' does. With it, the stream resumes: it
 * registers with the broker FIRST, then sends every stored event after
 * that seq from the store, then the live frames, dropping a live event it
 * already sent from the store. Registering before reading means an event
 * committed while the store is read is either in the read or in the queue,
 * so none is missed and none is sent twice; that is what a client that
 * listed, or whose stream ended, resumes with. The stream stays open for
 * the client's lifetime (a session always takes another turn), ending only
 * when the client leaves or when it falls more than the broker's budget
 * behind, which ends it with RESOURCE_EXHAUSTED so the client resumes from
 * the last seq it has instead of silently missing events (broker.ts).
 *
 * A direct handler (ConnectRPC server streams are async generators,
 * which cannot yield from inside the pipeline): an
 * authorizeDirect of the method's annotation (can_view on the session) at
 * the start, before the subscription is registered, and again before the
 * next frame once SESSION_EVENT_STREAM_REAUTHORIZE_MS has passed, so a
 * viewer whose access is withdrawn stops receiving events.
 *
 * Proven by __tests__/stream.test.ts and the session-events conformance
 * suite.
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
import type { SessionEventRecord } from "../../../store/session-events.js";
import type { SessionEventBroker } from "./broker.js";
import { eventOf } from "./codec.js";

export interface StreamSessionEventsDeps {
  /** Where a resumed stream reads the events after its cursor. */
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly sessionEventBroker: SessionEventBroker;
  /** Unix milliseconds; injectable for the re-authorization arm. */
  readonly now?: () => number;
}

/**
 * How long a stream serves on one authorization. A stream has no end of its
 * own (a session always takes another turn), so a viewer whose access is
 * withdrawn (a share revoked, a member removed) would keep receiving
 * events for as long as the connection lived: past this, the next frame
 * waits for the method's check again, and a refusal ends the stream with it.
 */
export const SESSION_EVENT_STREAM_REAUTHORIZE_MS = 5 * 60 * 1000;

/** The refusal a stream that fell behind ends with. */
export const STREAM_FELL_BEHIND_MESSAGE =
  "the event stream fell behind; stream again with after_seq set to the last event received";

/** How many stored events a resumed stream reads per round trip. */
export const SESSION_EVENT_REPLAY_BATCH = 100;

export async function* streamSessionEvents(
  deps: StreamSessionEventsDeps,
  req: StreamSessionEventsRequest,
  context: HandlerContext,
): AsyncGenerator<StreamSessionEventsResponse> {
  if (req.sessionId === "") {
    throw invalidArgumentError("session_id is required");
  }
  const now = deps.now ?? Date.now;
  const authorize = () =>
    authorizeDirect(SessionQueryController.method.streamEvents, deps.authorizer, callerIdentityOf(context), req);
  await authorize();
  let authorizedAt = now();

  const sessionId = req.sessionId;
  const subscription = deps.sessionEventBroker.subscribe(sessionId, req.eventDeltas);
  const abort = new Promise<void>((resolve) => {
    context.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const reauthorizeWhenDue = async (): Promise<void> => {
    if (now() - authorizedAt >= SESSION_EVENT_STREAM_REAUTHORIZE_MS) {
      await authorize();
      authorizedAt = now();
    }
  };
  try {
    // The resume: the stored events after the cursor, read after the
    // subscription registered (the module header says why).
    let sent: bigint | undefined;
    if (req.afterSeq !== undefined) {
      let after = Number(req.afterSeq);
      for (;;) {
        let records: SessionEventRecord[];
        try {
          records = await deps.store.sessionEvents.list(sessionId, {
            order: "asc",
            afterSeq: after,
            limit: SESSION_EVENT_REPLAY_BATCH,
          });
        } catch (error) {
          throw internalError(error, "failed to read the session's events");
        }
        for (const record of records) {
          await reauthorizeWhenDue();
          yield create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: eventOf(record) } });
          after = record.seq;
        }
        if (records.length < SESSION_EVENT_REPLAY_BATCH) {
          break;
        }
      }
      sent = BigInt(after);
    }
    while (!context.signal.aborted) {
      const frame = deps.sessionEventBroker.take(subscription);
      if (frame !== undefined) {
        if (sent !== undefined && frame.frame.case === "event" && frame.frame.value.seq <= sent) {
          continue;
        }
        await reauthorizeWhenDue();
        yield frame;
        continue;
      }
      // A subscription closes only when it overflowed or this stream
      // unsubscribed it, so a closed one with no frames left fell behind.
      if (subscription.closed) {
        throw new ConnectError(STREAM_FELL_BEHIND_MESSAGE, Code.ResourceExhausted);
      }
      await Promise.race([
        abort,
        new Promise<void>((resolve) => (subscription.notify = resolve)),
      ]);
      subscription.notify = undefined;
    }
  } finally {
    deps.sessionEventBroker.unsubscribe(sessionId, subscription);
  }
}

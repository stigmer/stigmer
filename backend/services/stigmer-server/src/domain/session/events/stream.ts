/**
 * SessionQueryController.streamEvents: a session's events as they are
 * appended, and the previews the stream asked for.
 *
 * The stream starts when it opens and sends nothing from before: a client
 * lists to catch up and skips the event ids it has seen, which is Managed
 * Agents' own pattern. It stays open for the client's lifetime (a session
 * always takes another turn), ending only when the client leaves or when
 * it falls more than the broker's capacity behind, which ends it with
 * RESOURCE_EXHAUSTED so the client lists from the last event it saw
 * instead of silently missing events (broker.ts).
 *
 * A direct handler, as run subscribe is (ConnectRPC server streams are
 * async generators, which cannot yield from inside the pipeline): an
 * authorizeDirect of the method's annotation (can_view on the session) at
 * the start, before the subscription is registered, and again before the
 * next frame once SESSION_EVENT_STREAM_REAUTHORIZE_MS has passed, so a
 * viewer whose access is withdrawn stops receiving events.
 *
 * Proven by __tests__/stream.test.ts and the session-events conformance
 * suite.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";

import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import type {
  StreamSessionEventsRequest,
  StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import type { Logger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { invalidArgumentError } from "../../../pipeline/errors.js";
import { callerIdentityOf } from "../../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../../pipeline/steps/authorize.js";
import type { SessionEventBroker } from "./broker.js";

export interface StreamSessionEventsDeps {
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
  "the event stream fell behind; list the events after the last one received, then stream again";

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
  try {
    while (!context.signal.aborted) {
      const frame = deps.sessionEventBroker.take(subscription);
      if (frame !== undefined) {
        if (now() - authorizedAt >= SESSION_EVENT_STREAM_REAUTHORIZE_MS) {
          await authorize();
          authorizedAt = now();
        }
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

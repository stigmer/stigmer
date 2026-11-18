/**
 * Request-metrics interceptor — the serving chain's RED emitter. One record per
 * RPC into `observability/rpc-metrics.ts`: the count and the duration,
 * labelled with the service, the method and the gRPC status name.
 *
 * Placement contract: SERVING chain only, immediately INSIDE the identity
 * source (chain.ts) and just outside the logging interceptor: after the
 * authentication interceptor that closes tokenless and invalid-token
 * calls, so metrics and logs observe the same set of requests and read
 * the same signal. An identity refusal is position 1's own record
 * (auth.ts logs it), never a counted request: it is an unauthenticated
 * caller's attempt, not the server's work, and an outermost emitter would
 * count an expired console tab's retries or an internet scanner beside
 * the API's real traffic. The caller guards run inside position 1, so a
 * guard refusal is not counted either. The in-process chain never
 * composes this interceptor: an in-process hop is not a request.
 *
 * The label is the code the call ended with as its caller saw it; which
 * codes page is the alert rule's business, not this interceptor's. How
 * the call ended is decided by rpc-end.ts, the rule the logging
 * interceptor reads too, so the count and the log line agree on every
 * call (stigmer/stigmer#2890). A failure is `ConnectError.from(error).code`,
 * exactly the logging interceptor's derivation: a raw non-ConnectError is
 * UNKNOWN here and INTERNAL on the wire after the error boundary outside
 * converts it — the boundary's error-level line names each such
 * conversion. A caller that left is CANCELLED, whatever the call did
 * after: a raw write that failed on the closed connection is the
 * departure, not a server fault, and the log keeps its error on the
 * "rpc cancelled" line. A unary call that succeeded after its caller left
 * did its whole job and is OK. Health is not measured
 * (the by-name authentication-exempt services — Kubernetes probes every
 * few seconds would own the request-rate signal; the auth and metrics skip
 * lists are the same names by construction); `is_public` methods
 * ARE measured — they are API.
 *
 * Duration is fractional milliseconds from interception to the RPC's
 * end. For a server stream that is the END OF THE STREAM: the response
 * iterable is re-wrapped, the error boundary's idiom, and the one record
 * fires in `finally`. A stream that ran to completion is OK, one that
 * threw carries the error's code, one the consumer stopped early is
 * CANCELLED, one that returned because its caller left (connect aborts
 * the request's signal and the stream handlers return on it) is
 * CANCELLED, and one that ended on its caller's deadline is
 * DEADLINE_EXCEEDED.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import {
  GRPC_STATUS_OK,
  grpcStatusName,
  recordRpc,
} from "../../observability/rpc-metrics.js";
import type { GrpcStatusName } from "../../observability/rpc-metrics.js";
import { AUTHENTICATION_EXEMPT_SERVICES } from "./auth.js";
import { classifyRpcEnd } from "./rpc-end.js";
import type { Outcome, RpcEnd } from "./rpc-end.js";

/** Test seam: a fake clock; production reads `performance.now()`. */
export type Clock = () => number;

export function createRequestMetricsInterceptor(
  now: Clock = () => performance.now(),
): Interceptor {
  return (next) => async (request) => {
    if (AUTHENTICATION_EXEMPT_SERVICES.has(request.service.typeName)) {
      return next(request);
    }
    const service = request.service.typeName;
    const method = request.method.name;
    const startedAt = now();
    const record = (outcome: Outcome): void => {
      const status = statusOf(classifyRpcEnd(request.signal, outcome));
      recordRpc(service, method, status, now() - startedAt);
    };

    let response;
    try {
      response = await next(request);
    } catch (error) {
      record({ ended: "threw", error });
      throw error;
    }
    if (!response.stream) {
      record({ ended: "completed", stream: false });
      return response;
    }
    return {
      ...response,
      message: measureStream(response.message, record),
    };
  };
}

/** The code the caller received, as gRPC's status name (the header). */
function statusOf(end: RpcEnd): GrpcStatusName {
  switch (end.end) {
    case "departed":
    case "stopped":
      return grpcStatusName(Code.Canceled);
    case "failed":
      return grpcStatusName(ConnectError.from(end.error).code);
    case "completed":
      return GRPC_STATUS_OK;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = end;
      return exhaustive;
    }
  }
}

/**
 * Records once when the stream ends, however it ends. `finally` runs on
 * completion, on a throw, and when the consumer returns early — the
 * three ways a server stream closes; `outcome` names the first two and
 * starts as the third.
 */
async function* measureStream<T>(
  messages: AsyncIterable<T>,
  record: (outcome: Outcome) => void,
): AsyncIterable<T> {
  let outcome: Outcome = { ended: "stopped" };
  try {
    yield* messages;
    outcome = { ended: "completed", stream: true };
  } catch (error) {
    outcome = { ended: "threw", error };
    throw error;
  } finally {
    record(outcome);
  }
}

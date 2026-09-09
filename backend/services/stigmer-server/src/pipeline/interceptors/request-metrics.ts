/**
 * Request-metrics interceptor — the serving chain's RED emitter, the TS
 * port of the cloud Java `GrpcRequestMetricsInterceptor` (convergence
 * entry 20260909.02, gate rulings Q1–Q5 as recommended). One record per
 * RPC into `observability/rpc-metrics.ts`: the count and the duration,
 * labelled with the service, the method and the gRPC status name.
 *
 * Placement contract: SERVING chain only, immediately INSIDE the identity
 * source (chain.ts). That is Java's real position —
 * `@Order(ORDER_SECURITY_AUTHENTICATION + 2)`, after the authentication
 * interceptor that closes tokenless and invalid-token calls — and the
 * position the logging interceptor already holds, so metrics and logs
 * observe the same set of requests: an identity refusal is position 1's
 * own record (auth.ts logs it), never a counted error. The choice has a
 * paging consequence and was ruled, not assumed: `grpc-error-rate-spike`
 * counts every non-OK code with no exclusions, and an outermost emitter
 * would page on an expired console tab's retries or an internet scanner
 * at a quiet hour. The disclosed deviation from Java: the caller guards
 * run inside position 1 here (Java's platform-client enforcement sat
 * inside its metrics), so a guard refusal is not counted either — fewer
 * errors counted, never more. The in-process chain never composes this
 * interceptor: an in-process hop is not a request.
 *
 * Status of a failure is `ConnectError.from(error).code`, exactly the
 * logging interceptor's derivation: a raw non-ConnectError is UNKNOWN
 * here and INTERNAL on the wire after the error boundary outside converts
 * it — the boundary's error-level line names each such conversion, and
 * grpc-java produced UNKNOWN for the same class. Health is not measured
 * (the by-name authentication-exempt services — Kubernetes probes every
 * few seconds would own the request-rate signal; Java's auth and metrics
 * skip lists are the same names by construction); `is_public` methods
 * ARE measured — they are API.
 *
 * Duration is fractional milliseconds from interception to the RPC's
 * end. For a server stream that is the END OF THE STREAM (Java measured
 * to `ServerCall.close`): the response iterable is re-wrapped, the error
 * boundary's idiom, and the one record fires in `finally` — OK when the
 * stream ran to completion, the error's code when it threw, CANCELLED
 * when the consumer stopped early (the client went away, or the
 * transport stopped pulling). The logging interceptor measures a stream
 * only to the handler's return; the difference is deliberate here and
 * disclosed there.
 */
import { ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import {
  GRPC_STATUS_OK,
  grpcStatusName,
  recordRpc,
} from "../../observability/rpc-metrics.js";
import type { GrpcStatusName } from "../../observability/rpc-metrics.js";
import { AUTHENTICATION_EXEMPT_SERVICES } from "./auth.js";

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
    const record = (status: GrpcStatusName): void => {
      recordRpc(service, method, status, now() - startedAt);
    };

    let response;
    try {
      response = await next(request);
    } catch (error) {
      record(statusOf(error));
      throw error;
    }
    if (!response.stream) {
      record(GRPC_STATUS_OK);
      return response;
    }
    return {
      ...response,
      message: measureStream(response.message, record),
    };
  };
}

function statusOf(error: unknown): GrpcStatusName {
  return grpcStatusName(ConnectError.from(error).code);
}

/**
 * Records once when the stream ends, however it ends. `finally` runs on
 * completion, on a throw, and when the consumer returns early — the
 * three ways a server stream closes; `outcome` distinguishes the first two
 * and its absence is the third.
 */
async function* measureStream<T>(
  messages: AsyncIterable<T>,
  record: (status: GrpcStatusName) => void,
): AsyncIterable<T> {
  let outcome: GrpcStatusName | undefined;
  try {
    yield* messages;
    outcome = GRPC_STATUS_OK;
  } catch (error) {
    outcome = statusOf(error);
    throw error;
  } finally {
    record(outcome ?? "CANCELLED");
  }
}

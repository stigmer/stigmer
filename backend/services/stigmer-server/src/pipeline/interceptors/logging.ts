/**
 * Logging interceptor — chain position 2.
 *
 * The level tiering is contract, not taste: expected-in-normal-operation
 * outcomes must not pollute operator logs at error level.
 *
 *   NotFound / AlreadyExists            → debug ("returned not found")
 *   InvalidArgument / FailedPrecondition → warn  ("client error")
 *   any other error code                 → error
 *   success                              → info — EXCEPT health-service
 *                                          methods, which log at debug
 *                                          (the CLI polls health)
 *   the caller left                      → info ("rpc cancelled"), debug
 *                                          for health, as a success is
 *
 * One line per RPC, written when the RPC ENDS. For a server stream that
 * is the end of the stream, not the handler's return: the response
 * iterable is re-wrapped (the folder's idiom, request-metrics.ts and
 * error-boundary.ts), so a stream that breaks part-way logs its error, and
 * `durationMs` is the stream's whole life (stigmer/stigmer#2691).
 *
 * The departure rule. A caller that leaves (a closed console tab, a
 * dropped connection, the server's shutdown destroying open requests)
 * does not reach the handler as an error: connect aborts the request's
 * signal and the stream handlers return on it (domain/session/events/
 * stream.ts, attention.ts, transport/health.ts). So the departure is read
 * from `request.signal`: aborted with a reason whose code is not
 * DeadlineExceeded means the caller left, and the line is "rpc cancelled"
 * with the reason's code (Canceled, Aborted, or Internal for an HTTP/2
 * protocol reset). It covers a stream however it ended, a stream the
 * consumer stopped early, and a unary call that FAILED after the abort; a
 * unary call that succeeded after its caller left did its whole job and
 * stays "rpc completed". A deadline is not a departure: the server ran
 * out of the caller's budget, so it is tiered by its code like any other
 * failure, including a stream that returned on the deadline's abort.
 *
 * The request-metrics interceptor also measures a stream to its end but
 * labels a departure by how the iterable ended, so the two disagree on a
 * closed tab (OK there, cancelled here) until that signal's owner decides
 * whether a departure is counted CANCELLED (request-metrics.ts).
 *
 * The log carries the REAL error while the wire carries the sanitized
 * status message: the `error` field is the thrown error's own message, whatever the handler chose to
 * put on the wire. For an internalError that message is the wire copy, so
 * the `cause` field carries the chain under the thrown error, which never
 * crosses the wire, and the deepest cause's stack goes to a debug line
 * (../error-cause.ts, stigmer/stigmer#1383).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type {
  Interceptor,
  StreamRequest,
  UnaryRequest,
} from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import { causeFields, causeStack } from "../error-cause.js";

/** Health successes are polled chatter, logged at debug. */
const HEALTH_SERVICE_TYPE_NAME = "grpc.health.v1.Health";

/** Test seam: a fake clock; production reads `performance.now()`. */
export type Clock = () => number;

/**
 * How an RPC ended, as the interceptor saw it. `stopped` is a stream the
 * consumer closed before its end (connect aborts the signal first, so a
 * real one also reads as a departure).
 */
type Outcome =
  | { readonly ended: "completed"; readonly stream: boolean }
  | { readonly ended: "stopped" }
  | { readonly ended: "threw"; readonly error: unknown };

type LoggedRequest = UnaryRequest | StreamRequest;

export function createLoggingInterceptor(
  logger: Logger,
  now: Clock = () => performance.now(),
): Interceptor {
  return (next) => async (request) => {
    const startedAt = now();
    const log = (outcome: Outcome): void => {
      logOutcome(logger, request, Math.round(now() - startedAt), outcome);
    };
    let response;
    try {
      response = await next(request);
    } catch (error) {
      log({ ended: "threw", error });
      throw error;
    }
    if (!response.stream) {
      log({ ended: "completed", stream: false });
      return response;
    }
    return { ...response, message: logStream(response.message, log) };
  };
}

/**
 * Logs once when the stream ends, however it ends: `finally` runs on
 * completion, on a throw, and when the consumer returns early.
 */
async function* logStream<T>(
  messages: AsyncIterable<T>,
  log: (outcome: Outcome) => void,
): AsyncIterable<T> {
  let outcome: Outcome = { ended: "stopped" };
  try {
    yield* messages;
    outcome = { ended: "completed", stream: true };
  } catch (error) {
    outcome = { ended: "threw", error };
    throw error;
  } finally {
    log(outcome);
  }
}

function logOutcome(
  logger: Logger,
  request: LoggedRequest,
  durationMs: number,
  outcome: Outcome,
): void {
  const procedure = `/${request.service.typeName}/${request.method.name}`;
  const isHealth = request.service.typeName === HEALTH_SERVICE_TYPE_NAME;
  const abort = abortCode(request.signal);
  const departed = abort !== undefined && abort !== Code.DeadlineExceeded;
  // A unary success after a departure did its whole job (the header).
  const unarySuccess = outcome.ended === "completed" && !outcome.stream;

  if (departed && !unarySuccess) {
    logCancelled(logger, isHealth, {
      procedure,
      code: Code[abort],
      durationMs,
    });
  } else if (outcome.ended === "threw") {
    logFailure(logger, procedure, durationMs, outcome.error);
  } else if (abort === Code.DeadlineExceeded && !unarySuccess) {
    // A stream that ended on its deadline's abort.
    logFailure(logger, procedure, durationMs, request.signal.reason);
  } else if (outcome.ended === "stopped") {
    // The consumer closed it with the signal still live.
    logCancelled(logger, isHealth, {
      procedure,
      code: Code[Code.Canceled],
      durationMs,
    });
  } else {
    logSuccess(logger, isHealth, { procedure, durationMs });
  }
}

/** The code of the signal's abort reason, or undefined while it runs. */
function abortCode(signal: AbortSignal): Code | undefined {
  return signal.aborted ? ConnectError.from(signal.reason).code : undefined;
}

function logSuccess(
  logger: Logger,
  isHealth: boolean,
  fields: { procedure: string; durationMs: number },
): void {
  if (isHealth) {
    logger.debug("rpc completed", fields);
  } else {
    logger.info("rpc completed", fields);
  }
}

function logCancelled(
  logger: Logger,
  isHealth: boolean,
  fields: { procedure: string; code: string; durationMs: number },
): void {
  if (isHealth) {
    logger.debug("rpc cancelled", fields);
  } else {
    logger.info("rpc cancelled", fields);
  }
}

function logFailure(
  logger: Logger,
  procedure: string,
  durationMs: number,
  error: unknown,
): void {
  const connectError = ConnectError.from(error);
  const fields = {
    procedure,
    code: Code[connectError.code],
    durationMs,
    // The real error, not the sanitized wire message.
    error: error instanceof Error ? error.message : String(error),
    ...causeFields(error),
  };
  switch (connectError.code) {
    case Code.NotFound:
    case Code.AlreadyExists:
      logger.debug("rpc returned not found", fields);
      break;
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
      logger.warn("rpc client error", fields);
      break;
    default:
      logger.error("rpc failed", fields);
  }
  const stack = causeStack(error);
  if (stack !== undefined) {
    logger.debug("rpc failure stack", { procedure, stack });
  }
}

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
 * How the call ended is decided by rpc-end.ts, the rule the request
 * metrics read too, so the line and the count agree on every call
 * (stigmer/stigmer#2890). A caller that left (the request's signal
 * aborted with any code but DeadlineExceeded) logs "rpc cancelled" with
 * the abort's code, for a stream however it ended and for a unary call
 * that failed; a unary call that succeeded after its caller left did its
 * whole job and stays "rpc completed". A call that threw keeps its error
 * on the cancelled line (`error`, `cause`, and the stack at debug), so a
 * real fault in a request its caller gave up on is still on record. A
 * deadline is not a departure: it is tiered by its code like any other
 * failure, including a stream that ended on the deadline's abort. A
 * stream the consumer stopped with the signal live logs "rpc cancelled"
 * with Canceled. What the signal cannot tell apart is in rpc-end.ts.
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

import type { LogFields, Logger } from "../../boot/logger.js";
import { causeFields, causeStack } from "../error-cause.js";
import { classifyRpcEnd } from "./rpc-end.js";
import type { Outcome } from "./rpc-end.js";

/** Health successes are polled chatter, logged at debug. */
const HEALTH_SERVICE_TYPE_NAME = "grpc.health.v1.Health";

/** Test seam: a fake clock; production reads `performance.now()`. */
export type Clock = () => number;

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
  const end = classifyRpcEnd(request.signal, outcome);

  switch (end.end) {
    case "departed": {
      const fields = { procedure, code: Code[end.code], durationMs };
      if (end.thrown === undefined) {
        logCancelled(logger, isHealth, fields);
      } else {
        logCancelled(logger, isHealth, {
          ...fields,
          ...errorFields(end.thrown.error),
        });
        logStack(logger, procedure, end.thrown.error);
      }
      break;
    }
    case "failed":
      logFailure(logger, procedure, durationMs, end.error);
      break;
    case "stopped":
      logCancelled(logger, isHealth, {
        procedure,
        code: Code[Code.Canceled],
        durationMs,
      });
      break;
    case "completed":
      logSuccess(logger, isHealth, { procedure, durationMs });
      break;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = end;
      return exhaustive;
    }
  }
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
  fields: { procedure: string; code: string; durationMs: number } & LogFields,
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
    ...errorFields(error),
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
  logStack(logger, procedure, error);
}

/** The real error, not the sanitized wire message, and its cause chain. */
function errorFields(error: unknown): LogFields {
  return {
    error: error instanceof Error ? error.message : String(error),
    ...causeFields(error),
  };
}

function logStack(logger: Logger, procedure: string, error: unknown): void {
  const stack = causeStack(error);
  if (stack !== undefined) {
    logger.debug("rpc failure stack", { procedure, stack });
  }
}

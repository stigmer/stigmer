/**
 * Logging interceptor — chain position 2, ported from the Go server's
 * loggingUnaryInterceptor/loggingStreamInterceptor
 * (backend/libs/go/grpc/server.go:273-381).
 *
 * The level tiering is contract, not taste: expected-in-normal-operation
 * outcomes must not pollute operator logs at error level.
 *
 *   NotFound / AlreadyExists            → debug ("returned not found")
 *   InvalidArgument / FailedPrecondition → warn  ("client error")
 *   any other error code                 → error
 *   success                              → info — EXCEPT health-service
 *                                          methods, which log at debug
 *                                          (the CLI polls health; Go
 *                                          server.go:328-331,343-345)
 *
 * Go logs err.Error() — the REAL error — while the wire carries the
 * sanitized status message (server.go:314-323). Mirrored here: the `error`
 * field is the thrown error's own message, whatever the handler chose to
 * put on the wire.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";

/** Health successes are polled chatter, logged at debug (Go grpc lib server.go:30). */
const HEALTH_SERVICE_TYPE_NAME = "grpc.health.v1.Health";

export function createLoggingInterceptor(logger: Logger): Interceptor {
  return (next) => async (request) => {
    const procedure = `/${request.service.typeName}/${request.method.name}`;
    const startedAt = performance.now();
    try {
      const response = await next(request);
      const fields = { procedure, durationMs: elapsed(startedAt) };
      if (request.service.typeName === HEALTH_SERVICE_TYPE_NAME) {
        logger.debug("rpc completed", fields);
      } else {
        logger.info("rpc completed", fields);
      }
      return response;
    } catch (error) {
      const connectError = ConnectError.from(error);
      const fields = {
        procedure,
        code: Code[connectError.code],
        durationMs: elapsed(startedAt),
        // The real error, not the sanitized wire message (Go parity).
        error: error instanceof Error ? error.message : String(error),
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
      throw error;
    }
  };
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

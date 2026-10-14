/**
 * The lane's errors in Anthropic's shape: an HTTP status whose class
 * Anthropic's SDK maps to its error classes (400 BadRequestError, 401
 * AuthenticationError, 403 PermissionDeniedError, 404 NotFoundError, ...)
 * and the body envelope it parses,
 * `{"type":"error","error":{"type":…,"message":…},"request_id":…}`.
 *
 * A native method's refusal maps by its Connect code through one table,
 * with the method's own message, which the serving chain's error boundary
 * has already sanitized for the caller. Anything that is not a Connect
 * error is an internal fault and says only that: its text never reaches the
 * wire. Billing refusals have no code of their own (the turn gates refuse
 * with FAILED_PRECONDITION and say why), so they read as
 * invalid_request_error with the gate's message.
 *
 * Proven by __tests__/rules.test.ts and __tests__/lane-composed.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";

/** Anthropic's error types (the SDK's ErrorType union) the lane writes. */
export type AnthropicErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "timeout_error"
  | "overloaded_error"
  | "api_error";

/** An error the lane answers with. */
export interface LaneError {
  readonly status: number;
  readonly type: AnthropicErrorType;
  readonly message: string;
}

/** The message an internal fault carries; its cause stays in the server's log. */
export const INTERNAL_ERROR_MESSAGE = "internal server error";

/** Whether a parse result is a refusal rather than its value. */
export function isLaneError(value: unknown): value is LaneError {
  return typeof value === "object" && value !== null && "status" in value && "type" in value && "message" in value;
}

export function laneError(status: number, type: AnthropicErrorType, message: string): LaneError {
  return { status, type, message };
}

export function invalidRequest(message: string): LaneError {
  return laneError(400, "invalid_request_error", message);
}

export function notFound(message: string): LaneError {
  return laneError(404, "not_found_error", message);
}

type StatusOfCode = { readonly status: number; readonly type: AnthropicErrorType };

/** The one table (module header): keyed by every Connect code, so the compiler holds it whole. */
const STATUS_BY_CODE: Readonly<Record<Code, StatusOfCode>> = {
  [Code.InvalidArgument]: { status: 400, type: "invalid_request_error" },
  [Code.FailedPrecondition]: { status: 400, type: "invalid_request_error" },
  [Code.OutOfRange]: { status: 400, type: "invalid_request_error" },
  [Code.Unauthenticated]: { status: 401, type: "authentication_error" },
  [Code.PermissionDenied]: { status: 403, type: "permission_error" },
  [Code.NotFound]: { status: 404, type: "not_found_error" },
  [Code.AlreadyExists]: { status: 409, type: "invalid_request_error" },
  [Code.Aborted]: { status: 409, type: "invalid_request_error" },
  [Code.ResourceExhausted]: { status: 429, type: "rate_limit_error" },
  [Code.DeadlineExceeded]: { status: 504, type: "timeout_error" },
  [Code.Unavailable]: { status: 503, type: "overloaded_error" },
  [Code.Canceled]: { status: 500, type: "api_error" },
  [Code.Unknown]: { status: 500, type: "api_error" },
  [Code.Unimplemented]: { status: 500, type: "api_error" },
  [Code.Internal]: { status: 500, type: "api_error" },
  [Code.DataLoss]: { status: 500, type: "api_error" },
};

/** The status and type a native refusal answers with. */
export function statusOfCode(code: Code): StatusOfCode {
  return STATUS_BY_CODE[code];
}

/** A native method's failure as the lane's error (module header). */
export function laneErrorOf(error: unknown): LaneError {
  if (!(error instanceof ConnectError)) {
    return laneError(500, "api_error", INTERNAL_ERROR_MESSAGE);
  }
  const { status, type } = statusOfCode(error.code);
  return laneError(status, type, status >= 500 && error.rawMessage === "" ? INTERNAL_ERROR_MESSAGE : error.rawMessage);
}

/** The error envelope Anthropic's SDK parses, as JSON text. */
export function errorEnvelope(error: LaneError, requestId: string): string {
  return JSON.stringify({
    type: "error",
    error: { type: error.type, message: error.message },
    request_id: requestId,
  });
}

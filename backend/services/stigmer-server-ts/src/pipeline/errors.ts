/**
 * Domain error constructors — port backend/libs/go/grpc/server.go's helper
 * family. Errors are API surface (guidelines §8): the CLI, console, and SDK
 * show these messages verbatim, so the FORMAT STRINGS are byte-pinned
 * contract, mirrored character-for-character from Go.
 *
 * The sanitization contract (stigmer/stigmer#478): internalError's
 * wire-visible description is ONLY the static message — the cause's raw
 * text can carry storage-engine detail or filesystem paths, and on an
 * anonymous surface that is information disclosure. The cause rides
 * ConnectError.cause for server-side logs; it never crosses the wire.
 */
import { Code, ConnectError } from "@connectrpc/connect";

/** Go NotFoundError: "%s not found: %s". */
export function notFoundError(resource: string, id: string): ConnectError {
  return new ConnectError(`${resource} not found: ${id}`, Code.NotFound);
}

/** Go InvalidArgumentError (callers pre-format their message). */
export function invalidArgumentError(message: string): ConnectError {
  return new ConnectError(message, Code.InvalidArgument);
}

/** Go AlreadyExistsError: "%s already exists: %s". */
export function alreadyExistsError(resource: string, id: string): ConnectError {
  return new ConnectError(`${resource} already exists: ${id}`, Code.AlreadyExists);
}

/**
 * Go FailedPreconditionError — the system is not in a state required for
 * the operation (vs AlreadyExists, which tells the caller to stop).
 */
export function failedPreconditionError(message: string): ConnectError {
  return new ConnectError(message, Code.FailedPrecondition);
}

/** Go AbortedError — retryable conflict (e.g. an in-flight dedupe claim). */
export function abortedError(message: string): ConnectError {
  return new ConnectError(message, Code.Aborted);
}

/** Go UnavailableError — a dependency is temporarily unreachable. */
export function unavailableError(message: string): ConnectError {
  return new ConnectError(message, Code.Unavailable);
}

/**
 * Go InternalError: the wire carries ONLY `message`; `cause` stays
 * server-side (#478). Callers keep writing
 * internalError(err, "failed to <do thing>") exactly as in Go — the split
 * between operator-visible detail and client-visible copy happens here.
 */
export function internalError(cause: unknown, message: string): ConnectError {
  return new ConnectError(message, Code.Internal, undefined, undefined, cause);
}

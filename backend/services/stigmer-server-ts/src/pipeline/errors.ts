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

/**
 * grpc-go's codes.Code.String() names, keyed by the connect Code enum.
 * Record<Code, string> keeps the map compile-time exhaustive: a new code
 * in the enum fails typecheck here instead of rendering "undefined" on
 * the wire.
 */
const GRPC_CODE_NAMES: Readonly<Record<Code, string>> = {
  [Code.Canceled]: "Canceled",
  [Code.Unknown]: "Unknown",
  [Code.InvalidArgument]: "InvalidArgument",
  [Code.DeadlineExceeded]: "DeadlineExceeded",
  [Code.NotFound]: "NotFound",
  [Code.AlreadyExists]: "AlreadyExists",
  [Code.PermissionDenied]: "PermissionDenied",
  [Code.ResourceExhausted]: "ResourceExhausted",
  [Code.FailedPrecondition]: "FailedPrecondition",
  [Code.Aborted]: "Aborted",
  [Code.OutOfRange]: "OutOfRange",
  [Code.Unimplemented]: "Unimplemented",
  [Code.Internal]: "Internal",
  [Code.Unavailable]: "Unavailable",
  [Code.DataLoss]: "DataLoss",
  [Code.Unauthenticated]: "Unauthenticated",
};

/**
 * grpc-go's codes.Code.String() name for a connect Code — for surfaces
 * that persist the code NAME rather than raise it (McpServer
 * connect_status.failure_code copies the blocking RPC's classification in
 * CamelCase form per status.proto's field doc).
 */
export function grpcCodeName(code: Code): string {
  return GRPC_CODE_NAMES[code];
}

/**
 * Reproduces the wire message grpc-go's status.FromError manufactures for
 * %w-wrapped status errors: when Go wraps a downstream in-process client
 * error with fmt.Errorf("%s: %w", ...), PipelineError.GRPCStatus's
 * errors.As branch keeps the INNER code but rewrites the message to the
 * full wrapped text — and the inner client error's Error() renders as
 * `rpc error: code = <CodeName> desc = <message>`. Byte-parity with Go on
 * the two arms that hit this (agent create's CreateDefaultInstance,
 * session create's ResolveDefaultAgentInstance). The transport-formatting
 * leak is filed as stigmer/stigmer#852 for a both-editions post-cutover
 * fix; until then this shim IS the wire contract.
 *
 * rawMessage is the code-prefix-free message — ConnectError.message
 * prepends "[code_name] ", which must not ride the manufactured desc.
 */
export function goWrappedStatusError(
  prefix: string,
  error: ConnectError,
): ConnectError {
  return new ConnectError(
    `${prefix}: ${goGrpcErrorText(error)}`,
    error.code,
  );
}

/**
 * The `%v` rendering of a grpc-go status error — `rpc error: code = <Name>
 * desc = <message>` — for sites that embed a downstream error's text under
 * a DIFFERENT outer code (e.g. workflowexecution's approval forwarding
 * flattens the child's status to Unavailable but Go's %v still prints the
 * inner wire text). goWrappedStatusError above is the %w twin that also
 * keeps the inner code.
 */
export function goGrpcErrorText(error: ConnectError): string {
  return `rpc error: code = ${GRPC_CODE_NAMES[error.code]} desc = ${error.rawMessage}`;
}

/**
 * Re-throws a downstream in-process client error UNWRAPPED — Go's
 * `return err // already a gRPC error from the client` arms, where the
 * inner status reaches the wire verbatim (no prefix, no manufactured
 * desc).
 *
 * A FRESH ConnectError is constructed on purpose: the router-transport
 * client's error instance carries the INNER response's metadata, and
 * serializing that metadata into the outer response's trailers produces
 * malformed HTTP/2 (the client surfaces NGHTTP2_PROTOCOL_ERROR instead of
 * the status — found by the local-ts-execution roster on agent-execution
 * create's unknown-agent arm, which is unreachable while the engine gate
 * refuses first). Same code, same rawMessage, no inherited metadata.
 */
export function rethrownStatusError(error: ConnectError): ConnectError {
  return new ConnectError(error.rawMessage, error.code);
}

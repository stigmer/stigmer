import { ConnectError, Code } from "@connectrpc/connect";

// ---------------------------------------------------------------------------
// Error categories
// ---------------------------------------------------------------------------

/**
 * Coarse-grained error categories derived from gRPC/Connect status codes.
 * Each category maps to a distinct UX treatment in the console.
 *
 * - `auth`         — session expired or missing credentials → redirect to login
 * - `permission`   — valid session but insufficient access → inline error
 * - `not-found`    — requested resource does not exist → inline error
 * - `validation`   — request rejected due to invalid input → inline / form error
 * - `server`       — unexpected server failure → inline error with retry
 * - `unavailable`  — server unreachable or overloaded → inline error with retry
 * - `cancelled`    — request aborted (usually by the user) → silent
 * - `unknown`      — non-ConnectError or unmapped code → inline error
 */
export type ErrorCategory =
  | "auth"
  | "permission"
  | "not-found"
  | "validation"
  | "server"
  | "unavailable"
  | "cancelled"
  | "unknown";

const CODE_TO_CATEGORY: Record<Code, ErrorCategory> = {
  [Code.Unauthenticated]: "auth",
  [Code.PermissionDenied]: "permission",
  [Code.NotFound]: "not-found",
  [Code.InvalidArgument]: "validation",
  [Code.FailedPrecondition]: "validation",
  [Code.OutOfRange]: "validation",
  [Code.Internal]: "server",
  [Code.Unknown]: "server",
  [Code.DataLoss]: "server",
  [Code.Unavailable]: "unavailable",
  [Code.DeadlineExceeded]: "unavailable",
  [Code.ResourceExhausted]: "unavailable",
  [Code.Canceled]: "cancelled",
  [Code.Aborted]: "validation",
  [Code.AlreadyExists]: "validation",
  [Code.Unimplemented]: "server",
};

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown thrown value to {@link ConnectError}.
 *
 * Uses `ConnectError[Symbol.hasInstance]` which handles cross-package
 * identity correctly (multiple copies of `@connectrpc/connect` in the
 * dependency tree).
 */
export function isConnectError(error: unknown): error is ConnectError {
  return error instanceof ConnectError;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Map any thrown value to an {@link ErrorCategory}.
 *
 * ConnectErrors are classified by their gRPC status code.
 * All other values (plain `Error`, strings, etc.) are `"unknown"`.
 */
export function classifyError(error: unknown): ErrorCategory {
  if (isConnectError(error)) {
    return CODE_TO_CATEGORY[error.code] ?? "unknown";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Retryability
// ---------------------------------------------------------------------------

const RETRYABLE_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "server",
  "unavailable",
]);

/**
 * Whether the error represents a transient failure that is worth retrying.
 *
 * Only `server` (INTERNAL, UNKNOWN, DATA_LOSS) and `unavailable`
 * (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED) errors are retryable.
 * Auth, permission, not-found, and validation errors are deterministic — the
 * same request will produce the same failure.
 */
export function isRetryableError(error: unknown): boolean {
  return RETRYABLE_CATEGORIES.has(classifyError(error));
}

// ---------------------------------------------------------------------------
// User-facing messages
// ---------------------------------------------------------------------------

const CATEGORY_FALLBACKS: Record<ErrorCategory, string> = {
  auth: "Your session has expired. Please sign in again.",
  permission: "You do not have permission to perform this action.",
  "not-found": "The requested resource was not found.",
  validation: "The request contains invalid data.",
  server: "An unexpected server error occurred. Please try again.",
  unavailable:
    "The server is temporarily unavailable. Please try again in a moment.",
  cancelled: "The request was cancelled.",
  unknown: "An unexpected error occurred.",
};

/**
 * Infrastructure-level messages that should never reach the user. Matched
 * case-insensitively against `error.message`.
 */
const INFRA_NOISE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/no healthy upstream/i, "The server is temporarily unavailable."],
  [/ECONNREFUSED/i, "Unable to connect to the server."],
  [/ECONNRESET/i, "The connection to the server was lost."],
  [/ETIMEDOUT/i, "The request timed out. Please try again."],
  [/fetch failed/i, "Unable to reach the server. Check your connection."],
  [/network error/i, "A network error occurred. Check your connection."],
  [/failed to fetch/i, "Unable to reach the server. Check your connection."],
  [/load balancer/i, "The server is temporarily unavailable."],
];

/**
 * Extract a clean, user-appropriate error message from any thrown value.
 *
 * 1. If the error is a {@link ConnectError}, uses `rawMessage` (which
 *    excludes the `[code]` prefix added by Connect-RPC).
 * 2. Sanitizes infrastructure noise (e.g., "no healthy upstream") into
 *    readable text.
 * 3. Falls back to a category-specific default when the raw message is
 *    empty or is itself infrastructure noise.
 *
 * @param error    — the thrown value (typically from a catch block)
 * @param fallback — optional override for the default fallback message
 */
export function getUserMessage(error: unknown, fallback?: string): string {
  const raw = extractRawMessage(error);
  const sanitized = sanitizeMessage(raw);

  if (sanitized) return sanitized;

  const category = classifyError(error);
  return fallback ?? CATEGORY_FALLBACKS[category];
}

function extractRawMessage(error: unknown): string {
  if (isConnectError(error)) {
    return error.rawMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function sanitizeMessage(message: string): string {
  if (!message) return "";

  for (const [pattern, replacement] of INFRA_NOISE_PATTERNS) {
    if (pattern.test(message)) return replacement;
  }

  return message;
}

// ---------------------------------------------------------------------------
// RPC metadata (attached by the metadata interceptor)
// ---------------------------------------------------------------------------

export interface RpcErrorMetadata {
  /** RPC method name (e.g., "get", "list", "create"). */
  readonly method: string;
  /** Full RPC path (e.g., "/stigmer.agent.v1.AgentQueryController/Get"). */
  readonly path: string;
}

const rpcMetadataStore = new WeakMap<object, RpcErrorMetadata>();

/**
 * Attach RPC call metadata to an error object for downstream consumers
 * (error display components, logging, observability).
 *
 * Called by the metadata interceptor — application code should use
 * {@link getRpcMetadata} to read metadata, not this function.
 */
export function annotateRpcError(
  error: object,
  metadata: RpcErrorMetadata,
): void {
  rpcMetadataStore.set(error, metadata);
}

/**
 * Retrieve RPC metadata previously attached by the metadata interceptor.
 * Returns `undefined` if the error was not annotated (e.g., non-RPC errors,
 * errors that bypassed the interceptor chain).
 */
export function getRpcMetadata(
  error: unknown,
): RpcErrorMetadata | undefined {
  if (error !== null && typeof error === "object") {
    return rpcMetadataStore.get(error);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience
// ---------------------------------------------------------------------------

export { ConnectError, Code } from "@connectrpc/connect";

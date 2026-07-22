import { ConnectError, Code } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { StigmerError, type ErrorCode } from "./gen/errors.js";

// Re-export generated error types
export {
  StigmerError,
  type ErrorCode,
  wrapError,
  isNotFound,
  isUnauthenticated,
  isPermissionDenied,
  isRetryable,
} from "./gen/errors.js";

/**
 * Coarse-grained error categories derived from gRPC/Connect status codes.
 * Each category maps to a distinct UX treatment:
 *
 * - `auth`         — session expired or missing credentials (redirect to login)
 * - `permission`   — valid session but insufficient access (inline error)
 * - `not-found`    — requested resource does not exist (inline error)
 * - `validation`   — request rejected due to invalid input (inline / form error)
 * - `server`       — unexpected server failure (inline error with retry)
 * - `unavailable`  — server unreachable or overloaded (inline error with retry)
 * - `cancelled`    — request aborted, usually by the user (silent)
 * - `unknown`      — non-RPC error or unmapped code (inline error)
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

const CONNECT_CODE_TO_CATEGORY: Record<number, ErrorCategory> = {
  [Code.Unauthenticated]: "auth",
  [Code.PermissionDenied]: "permission",
  [Code.NotFound]: "not-found",
  [Code.InvalidArgument]: "validation",
  [Code.FailedPrecondition]: "validation",
  [Code.OutOfRange]: "validation",
  [Code.AlreadyExists]: "validation",
  [Code.Aborted]: "validation",
  [Code.Internal]: "server",
  [Code.Unknown]: "server",
  [Code.DataLoss]: "server",
  [Code.Unimplemented]: "server",
  [Code.Unavailable]: "unavailable",
  [Code.DeadlineExceeded]: "unavailable",
  [Code.ResourceExhausted]: "unavailable",
  [Code.Canceled]: "cancelled",
};

const ERROR_CODE_TO_CATEGORY: Record<ErrorCode, ErrorCategory> = {
  unauthenticated: "auth",
  "permission-denied": "permission",
  "not-found": "not-found",
  "invalid-argument": "validation",
  "already-exists": "validation",
  "failed-precondition": "validation",
  "resource-exhausted": "unavailable",
  internal: "server",
  unavailable: "unavailable",
  cancelled: "cancelled",
  unknown: "server",
};

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

/**
 * Map any thrown value to an {@link ErrorCategory}.
 *
 * Handles both {@link StigmerError} (thrown by SDK methods) and raw
 * {@link ConnectError} (from direct transport usage). All other values
 * are classified as `"unknown"`.
 */
export function classifyError(error: unknown): ErrorCategory {
  if (error instanceof StigmerError) {
    return ERROR_CODE_TO_CATEGORY[error.code] ?? "unknown";
  }
  if (isConnectError(error)) {
    return CONNECT_CODE_TO_CATEGORY[error.code] ?? "unknown";
  }
  return "unknown";
}

const RETRYABLE_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "server",
  "unavailable",
]);

/**
 * Whether the error represents a transient failure worth retrying.
 *
 * Only `server` and `unavailable` categories are retryable. Auth, permission,
 * not-found, and validation errors are deterministic — the same request
 * will produce the same failure.
 */
export function isRetryableError(error: unknown): boolean {
  return RETRYABLE_CATEGORIES.has(classifyError(error));
}

/**
 * Whether an error from a long-lived streaming subscription should be
 * treated as a transient transport hiccup worth auto-reconnecting.
 *
 * Broader than {@link isRetryableError}: in addition to the retryable
 * `server`/`unavailable` categories, it recognizes raw transport noise
 * (WebKit's "Load failed", Chrome's "Failed to fetch", Node's "fetch
 * failed", `ECONNRESET`, …) that surfaces as a bare `TypeError` and would
 * otherwise classify as `unknown` (non-retryable). Those are precisely the
 * drops a stream hits on laptop sleep, network blips, and idle timeouts —
 * an infrastructure event, never a user-actionable one. Deterministic
 * failures (not-found, invalid-argument, auth) remain non-transient: the
 * same request would fail the same way, so retrying only hammers.
 */
export function isTransientStreamError(error: unknown): boolean {
  if (isRetryableError(error)) return true;
  return matchesInfraNoise(extractRawMessage(error));
}

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
 * Maps enriched auth error descriptions from the backend into developer-friendly
 * guidance. These patterns match the actionable descriptions returned by the
 * gRPC interceptor chain (GrpcSecurityConfigBase + GrpcRequestContextBuilderInterceptor).
 */
const AUTH_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /token audience does not match/i,
    "The token's audience does not match the IdentityProvider's expected_audience. " +
      "Verify your Auth0 API identifier matches the expected_audience configured in Stigmer.",
  ],
  [
    /token signature verification failed/i,
    "Token signature verification failed. " +
      "Check that the IdentityProvider's jwks_uri points to the correct JWKS endpoint.",
  ],
  [
    /token has expired/i,
    "The access token has expired. Request a new token and retry.",
  ],
  [
    /federated identity account not found/i,
    "No identity account exists for this user. " +
      "The platform must create a federated account via createFederatedAccount " +
      "before the user can authenticate.",
  ],
  [
    /account provisioning failed/i,
    "SSO account provisioning failed. " +
      "Ensure the IdentityProvider's userinfo_endpoint is configured and the " +
      "access token includes the 'openid email profile' scopes.",
  ],
];

const INFRA_NOISE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/no healthy upstream/i, "The server is temporarily unavailable."],
  [/ECONNREFUSED/i, "Unable to connect to the server."],
  [/ECONNRESET/i, "The connection to the server was lost."],
  [/ETIMEDOUT/i, "The request timed out. Please try again."],
  [/fetch failed/i, "Unable to reach the server. Check your connection."],
  [/network error/i, "A network error occurred. Check your connection."],
  [/failed to fetch/i, "Unable to reach the server. Check your connection."],
  // WebKit (Safari / WKWebView, e.g. Tauri on macOS) phrases a failed
  // `fetch` as a bare `TypeError: Load failed` — the WebKit analogue of
  // Chrome's "Failed to fetch" and Node's "fetch failed" above.
  [/load failed/i, "The connection to the server was lost."],
  [/load balancer/i, "The server is temporarily unavailable."],
  [/illegal invocation/i, "A browser API call failed. Please try again."],
  [/can only call .+ on instances of/i, "A browser API call failed. Please try again."],
];

/**
 * Extract a clean, user-appropriate error message from any thrown value.
 *
 * 1. For {@link StigmerError} or {@link ConnectError}, uses the raw message
 *    (which excludes the `[code]` prefix added by Connect-RPC).
 * 2. Sanitizes infrastructure noise (e.g., "no healthy upstream") into
 *    readable text.
 * 3. Falls back to a category-specific default when the raw message is
 *    empty or is infrastructure noise.
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
  if (error instanceof StigmerError) {
    return error.message;
  }
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
  for (const [pattern, replacement] of AUTH_ERROR_PATTERNS) {
    if (pattern.test(message)) return replacement;
  }
  for (const [pattern, replacement] of INFRA_NOISE_PATTERNS) {
    if (pattern.test(message)) return replacement;
  }
  return message;
}

/**
 * Whether a message matches a known infrastructure-noise pattern — the
 * single source of truth shared by {@link getUserMessage} (which rewrites
 * it for display) and {@link isTransientStreamError} (which retries it).
 */
function matchesInfraNoise(message: string): boolean {
  if (!message) return false;
  for (const [pattern] of INFRA_NOISE_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  return false;
}

/**
 * A machine-readable refusal reason extracted from a server error's
 * `google.rpc.ErrorInfo` detail — the platform's structured-error
 * contract (domain `stigmer.ai`; per-RPC reasons are documented on the
 * refusing RPC's proto comment).
 */
export interface ErrorReason {
  /** The reason code, e.g. `"SLACK_WORKSPACE_ALREADY_CONNECTED"`. */
  readonly reason: string;
  /** The emitting domain, e.g. `"stigmer.ai"`. */
  readonly domain: string;
  /** Reason-specific facts, e.g. `{ team_name: "Acme" }`. */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Extract the structured refusal reason from any thrown value, or `null`
 * when the error carries none.
 *
 * Servers attach `google.rpc.ErrorInfo` to refusals a client should
 * branch on (rather than parse the human-readable copy). SDK methods
 * wrap the transport's {@link ConnectError} in a {@link StigmerError}
 * with the original chained as `cause`, so this walks the cause chain
 * to the ConnectError and reads its detail payloads.
 *
 * Absence is normal — older servers, transport failures, and refusals
 * with no machine-readable reason all return `null`; callers fall back
 * to {@link getUserMessage}.
 */
export function getErrorReason(error: unknown): ErrorReason | null {
  let current: unknown = error;
  while (current !== null && current !== undefined) {
    if (isConnectError(current)) {
      const info = current.findDetails(ErrorInfoSchema)[0];
      if (!info) return null;
      return {
        reason: info.reason,
        domain: info.domain,
        metadata: { ...info.metadata },
      };
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

/**
 * The `google.rpc.ErrorInfo` domain attached by datastore record-RPC
 * errors in both editions (a cross-edition contract; see the OSS
 * `dserrors` package and its Java mirror).
 */
const RECORDS_ERROR_DOMAIN = "datastore.stigmer.ai";

/**
 * Extract the violated constraint's declared name from a datastore
 * record-RPC error, or `null` when the error carries none.
 *
 * Record writes rejected by a declared constraint (`ALREADY_EXISTS` for
 * uniques, `FAILED_PRECONDITION` for check/exists/not_exists) attach a
 * `google.rpc.ErrorInfo` with reason `CONSTRAINT_VIOLATION` and the
 * constraint's name in `metadata["constraint"]` — the same companion
 * the MCP bridge's record tools surface to agents. Consumers map the
 * name through the datastore spec to place the (verbatim) message next
 * to the fields the constraint covers; `null` falls back to a
 * form-level rendering of {@link getUserMessage}.
 */
export function getRecordConstraint(error: unknown): string | null {
  const reason = getErrorReason(error);
  if (!reason || reason.domain !== RECORDS_ERROR_DOMAIN) return null;
  const constraint = reason.metadata["constraint"];
  return constraint !== undefined && constraint !== "" ? constraint : null;
}

/**
 * Metadata about the RPC call that produced an error. Attached by the
 * SDK's metadata interceptor and readable via {@link getRpcMetadata}.
 */
export interface RpcErrorMetadata {
  readonly method: string;
  readonly path: string;
}

const rpcMetadataStore = new WeakMap<object, RpcErrorMetadata>();

/**
 * Attach RPC call metadata to an error object.
 *
 * Called by the metadata interceptor — application code should use
 * {@link getRpcMetadata} to read metadata, not this function.
 *
 * @internal
 */
export function annotateRpcError(
  error: object,
  metadata: RpcErrorMetadata,
): void {
  rpcMetadataStore.set(error, metadata);
}

/**
 * Retrieve RPC metadata previously attached by the metadata interceptor.
 * Returns `undefined` if the error was not annotated.
 */
export function getRpcMetadata(error: unknown): RpcErrorMetadata | undefined {
  if (error !== null && typeof error === "object") {
    return rpcMetadataStore.get(error);
  }
  return undefined;
}

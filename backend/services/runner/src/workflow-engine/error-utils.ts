/**
 * Error message extraction utilities — used by the do-executor to
 * unwrap Temporal ActivityFailure chains and surface the root cause
 * error message to users.
 *
 * Uses duck-typing (checking for `.cause` and `.message` properties)
 * instead of `instanceof` checks to avoid importing Temporal-specific
 * error classes. This is necessary because the do-executor runs
 * inside the Temporal deterministic V8 sandbox, where Temporal types
 * come from `@temporalio/workflow`, not `@temporalio/activity`.
 *
 * Sandbox-safe: zero dependencies, no Node.js or Temporal imports.
 */

export interface StructuredErrorInfo {
  readonly category: string;
  readonly message: string;
  readonly detail: string;
  readonly retryable: boolean;
}

interface ErrorLike {
  message: string;
  cause?: unknown;
  type?: string;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    value !== null &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as ErrorLike).message === "string"
  );
}

/**
 * Finds the root-cause error by walking the `.cause` chain.
 * Returns the innermost ErrorLike, or the original if no chain exists.
 */
function findRootCause(err: ErrorLike): ErrorLike {
  if (err.cause && isErrorLike(err.cause)) {
    return err.cause;
  }
  return err;
}

/**
 * Unwraps nested error chains (e.g. ActivityFailure → ApplicationFailure)
 * to extract the root-cause error message that is meaningful to users.
 *
 * If the innermost error has a `type` property (as ApplicationFailure does),
 * it is included as a `[TYPE]` prefix for structured identification.
 *
 * Temporal's ActivityFailure wraps the real error in `.cause`. This
 * function walks the `.cause` chain to find the deepest error with a
 * meaningful message.
 */
export function extractRootErrorMessage(err: unknown): string {
  if (!isErrorLike(err)) {
    return String(err);
  }

  const root = findRootCause(err);
  if (root !== err && root.type && typeof root.type === "string") {
    return `[${root.type}] ${root.message}`;
  }
  return root.message;
}

/**
 * Extracts structured error information from a Temporal error chain.
 *
 * When the root cause is an ApplicationFailure with a `type` field
 * (set by classifyAndThrowLlmError and similar classifiers), this
 * returns a StructuredErrorInfo with the category, user-facing message,
 * raw detail, and retryability flag.
 *
 * Returns null if the error has no structured classification.
 */
export function extractStructuredError(err: unknown): StructuredErrorInfo | null {
  if (!isErrorLike(err)) return null;

  const root = findRootCause(err);
  if (!root.type || typeof root.type !== "string") return null;

  const isNonRetryable = "nonRetryable" in (root as unknown as Record<string, unknown>)
    ? !!(root as unknown as Record<string, unknown>).nonRetryable
    : true;

  return {
    category: root.type,
    message: root.message,
    detail: err !== root ? err.message : "",
    retryable: !isNonRetryable,
  };
}

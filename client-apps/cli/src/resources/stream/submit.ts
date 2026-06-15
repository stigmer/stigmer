// Approval-submission resilience for the headless stream driver.
//
// Ports the retry/backoff machinery from Go's run_stream_events.go:21-191:
// approval submits race a transient DB-consistency window ("no pending
// approvals") and ordinary network blips, so they retry with exponential
// backoff. Also ports classifyStreamError (:53-82) — the user-facing message
// for a dropped Subscribe stream, with a resume hint.

import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";

export const APPROVAL_RETRY_MAX_ATTEMPTS = 3;
export const APPROVAL_RETRY_BASE_DELAY_MS = 1000;

const MAX_CHAIN_DEPTH = 20;

/**
 * Retry `fn` up to `maxAttempts` times with doubling backoff, stopping early on
 * success, a non-retryable error, or abort. Mirrors Go's retryWithBackoff. The
 * delay between attempts is abort-aware. Rejects with the last error on failure.
 */
export async function retryWithBackoff(
  signal: AbortSignal,
  maxAttempts: number,
  baseDelayMs: number,
  fn: () => Promise<void>,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableSubmitError(err)) throw err;
      if (attempt < maxAttempts - 1) {
        await abortableDelay(baseDelayMs * 2 ** attempt, signal);
      }
    }
  }
  throw lastErr;
}

/**
 * True when an approval-submit error is transient and worth retrying. Mirrors
 * Go's isRetryableSubmitError, including the "no pending approvals" special
 * case. Non-RPC errors default to retryable (typically transient I/O).
 */
export function isRetryableSubmitError(err: unknown): boolean {
  const coded = extractCoded(err);
  if (coded === undefined) return true;

  switch (coded.code) {
    case Code.Unavailable:
    case Code.DeadlineExceeded:
    case Code.ResourceExhausted:
    case Code.Aborted:
    case Code.Internal:
    case Code.Unknown:
      return true;
    case Code.FailedPrecondition:
      return coded.message.includes("no pending approvals");
    default:
      return false;
  }
}

/**
 * Translate a dropped Subscribe stream error into a user-facing message with a
 * resume hint. Mirrors Go's classifyStreamError.
 */
export function classifyStreamError(err: unknown, sessionId: string): string {
  let message: string;
  const coded = extractCoded(err);
  if (coded === undefined) {
    message = `Unexpected stream error: ${messageOf(err)}`;
  } else {
    switch (coded.code) {
      case Code.Unavailable:
        message = "Connection to server lost.";
        break;
      case Code.Canceled:
        message = "Server cancelled the stream.";
        break;
      case Code.DeadlineExceeded:
        message = "Server response timed out.";
        break;
      default:
        message = `Stream error (${Code[coded.code] ?? "Unknown"}): ${coded.message}`;
    }
  }

  if (sessionId !== "") message += `\nRe-attach to this session: stigmer resume ${sessionId}`;
  return message;
}

interface CodedError {
  readonly code: number;
  readonly message: string;
}

// Walk the cause chain for the first SDK/Connect coded error. Mirrors the
// Unwrap walk in errors/classify.ts.
function extractCoded(err: unknown): CodedError | undefined {
  let depth = 0;
  for (let current: unknown = err; current != null && depth < MAX_CHAIN_DEPTH; current = causeOf(current), depth++) {
    if (current instanceof StigmerError) return { code: current.connectCode, message: current.message };
    if (current instanceof ConnectError) return { code: current.code, message: current.rawMessage };
  }
  return undefined;
}

function causeOf(value: unknown): unknown {
  return value !== null && typeof value === "object" ? (value as { cause?: unknown }).cause : undefined;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return String(value);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

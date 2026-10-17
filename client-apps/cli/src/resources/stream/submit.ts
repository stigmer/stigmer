// Answer-submission resilience for the headless stream driver, and the
// user-facing message for a dropped event stream.
//
// An answer races ordinary network blips, so a transient failure retries
// with exponential backoff. A FAILED_PRECONDITION is final: the call no
// longer waits (another answer, or a grant on its class, settled it, or its
// turn ended), which the driver reads as settled rather than failed.
// classifyStreamError words a stream that dropped for good, with a resume
// hint.

import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";

export const APPROVAL_RETRY_MAX_ATTEMPTS = 3;
export const APPROVAL_RETRY_BASE_DELAY_MS = 1000;

const MAX_CHAIN_DEPTH = 20;

/**
 * Retry `fn` up to `maxAttempts` times with doubling backoff, stopping early on
 * success, a non-retryable error, or abort. The delay between attempts is
 * abort-aware. Rejects with the last error on failure.
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
 * True when an answer-submit error is transient and worth retrying.
 * Non-RPC errors default to retryable (typically transient I/O).
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
    default:
      return false;
  }
}

/**
 * True when an answer was refused because the call no longer waits: it was
 * answered already (a grant on its class allows every waiting call of the
 * class at once) or its turn ended.
 */
export function isSettledAnswerError(err: unknown): boolean {
  return extractCoded(err)?.code === Code.FailedPrecondition;
}

/**
 * Translate a dropped event-stream error into a user-facing message with a
 * resume hint.
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

// Walk the cause chain for the first SDK/Connect coded error, as
// errors/classify.ts does.
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

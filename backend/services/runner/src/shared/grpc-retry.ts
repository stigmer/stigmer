/**
 * gRPC error classification for status persistence retries.
 *
 * Status persistence flows through a single chokepoint — `persistStatus` in
 * status.ts — which uses these helpers to decide whether a failed
 * `updateStatus` should back off and retry (transient transport errors) or
 * fail fast (deterministic errors). This module is intentionally just the
 * classification policy + its options type, kept small and separately tested;
 * the persist loop that consumes it lives with the rest of the persist logic.
 */

import { ConnectError, Code } from "@connectrpc/connect";

export interface RetryOptions {
  /** Base delay before the first retry (ms). Default: 100. */
  readonly baseDelayMs?: number;
  /** Backoff multiplier between retries. Default: 2. */
  readonly backoffFactor?: number;
  /** Maximum number of retry attempts. Default: 3. */
  readonly maxRetries?: number;
  /** Injectable delay function for testing. */
  readonly delayFn?: (ms: number) => Promise<void>;
}

const RETRYABLE_CODES = new Set<Code>([
  Code.Unavailable,
  Code.DeadlineExceeded,
]);

const TERMINAL_CODES = new Set<Code>([
  Code.InvalidArgument,
  Code.NotFound,
  Code.PermissionDenied,
]);

/** True for transient transport errors that are worth retrying with backoff. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ConnectError) {
    return RETRYABLE_CODES.has(err.code);
  }
  return false;
}

/** True for deterministic errors that retrying cannot fix. */
export function isTerminalError(err: unknown): boolean {
  if (err instanceof ConnectError) {
    return TERMINAL_CODES.has(err.code);
  }
  return false;
}

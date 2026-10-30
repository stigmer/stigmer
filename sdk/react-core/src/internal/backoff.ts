/**
 * Exponential-backoff scheduling for resilient stream reconnection.
 *
 * Pure and framework-agnostic — the timing math is a plain function and the
 * wait is a cancelable promise, so both are exhaustively unit-testable
 * without React or fake DOM (mirrors the codebase's extract-the-pure-core
 * convention, e.g. `computeFollowCenter` / `isRecoveryTransition`).
 *
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */

/** Tunable backoff schedule. All fields optional — sensible defaults apply. */
export interface BackoffOptions {
  /** Delay before the first retry, in milliseconds. */
  readonly baseDelayMs?: number;
  /** Upper bound on any single delay, in milliseconds. */
  readonly maxDelayMs?: number;
  /** Multiplier applied per attempt (`base * factor^(attempt-1)`). */
  readonly factor?: number;
}

/** Delay before the first reconnect attempt. */
export const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
/** Ceiling for any single reconnect delay. */
export const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
/** Per-attempt growth multiplier. */
export const DEFAULT_RECONNECT_FACTOR = 2;
/**
 * Attempts before giving up and surfacing a terminal error: none by
 * default. A turn can run for hours while its person is away (a closed lid,
 * a train), and any cap ends the follow of exactly that turn (stigmer#2418).
 * A stream that can never recover is a refusal (a deleted session, access
 * withdrawn), which ends the follow without spending attempts; the
 * {@link DEFAULT_RECONNECT_MAX_DELAY_MS} ceiling bounds what a long outage
 * costs. A caller that wants a cap passes `maxAttempts`.
 */
export const DEFAULT_RECONNECT_MAX_ATTEMPTS = Number.POSITIVE_INFINITY;

/**
 * How long (ms) a stream must have stayed open for its end to count as a
 * fresh drop rather than one more failure in a row. A proxy's idle close of
 * a quiet session, or a server restart, then re-opens within the first
 * backoff step instead of climbing toward the ceiling; a stream that ends
 * at once keeps backing off, so a front that ends every stream immediately
 * never causes a hot loop.
 */
export const HEALTHY_STREAM_MS = 30_000;

/**
 * Compute the backoff delay (ms) for a 1-based reconnect attempt.
 *
 * Exponential growth (`base * factor^(attempt-1)`) capped at `maxDelayMs`,
 * then **full jitter** — a uniform random point in `[0, capped]`. Full
 * jitter (AWS, "Exponential Backoff And Jitter") de-synchronizes a fleet of
 * clients that all dropped at the same instant, preventing a reconnect
 * thundering herd against a recovering server.
 *
 * `random` is injectable purely so tests can assert exact values; callers
 * should omit it.
 */
export function computeBackoffDelay(
  attempt: number,
  opts?: BackoffOptions,
  random: () => number = Math.random,
): number {
  const base = opts?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
  const max = opts?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  const factor = opts?.factor ?? DEFAULT_RECONNECT_FACTOR;

  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = base * factor ** (safeAttempt - 1);
  const capped = Math.min(exponential, max);
  return Math.round(random() * capped);
}

/** Rejection reason for an aborted {@link sleep}, distinguishable by name. */
export class AbortError extends Error {
  constructor() {
    super("The operation was aborted.");
    this.name = "AbortError";
  }
}

/**
 * Promise-based delay that settles after `ms`, or rejects immediately with
 * {@link AbortError} if `signal` is (or becomes) aborted.
 *
 * The timer is cleared and the abort listener removed on every exit path, so
 * a reconnect wait leaves nothing pending when a component unmounts or the
 * subscription is torn down mid-backoff — no leaked timer, no resubscribe
 * after teardown.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

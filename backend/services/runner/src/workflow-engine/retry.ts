/**
 * Retry delay calculator for CNCF Serverless Workflow catch-level retry.
 *
 * Pure, deterministic functions that compute the delay (in milliseconds)
 * for a given retry attempt based on the retry policy configuration.
 * No side effects, no Temporal imports, no Node.js dependencies.
 *
 * Supports three backoff strategies:
 * - constant: delay stays the same every attempt
 * - exponential: delay doubles each attempt (delay * 2^(attempt-1))
 * - linear: delay grows linearly (delay * attempt)
 *
 * Jitter adds a random offset in [from, to] to the computed delay.
 * Math.random() is used for jitter — Temporal's sandbox replaces it
 * with a deterministic PRNG, so jitter values replay identically.
 *
 * @module
 */

import type { RetryConfig, BackoffConfig } from "./types.js";
import { durationToMs } from "./duration.js";

const DEFAULT_BASE_DELAY_MS = 1_000;

/**
 * Computes the delay in milliseconds for a retry attempt, or returns
 * `null` if the retry limits have been exceeded and no more retries
 * should be attempted.
 *
 * @param attempt - 1-indexed retry attempt number (1 = first retry)
 * @param config - the retry policy from `catch.retry`
 * @param elapsedMs - cumulative delay already spent on prior retries
 * @returns delay in ms, or `null` if limits exceeded
 */
export function computeRetryDelay(
  attempt: number,
  config: RetryConfig,
  elapsedMs: number,
): number | null {
  if (exceedsAttemptLimit(attempt, config)) return null;

  const baseMs = resolveBaseDelay(config);
  const multiplier = resolveBackoffMultiplier(attempt, config.backoff);
  let delay = baseMs * multiplier;

  delay += resolveJitter(config);

  delay = Math.max(0, Math.round(delay));

  if (exceedsDurationLimit(elapsedMs + delay, config)) return null;

  return delay;
}

function exceedsAttemptLimit(attempt: number, config: RetryConfig): boolean {
  const maxAttempts = config.limit?.attempt?.count;
  if (maxAttempts !== undefined && attempt > maxAttempts) return true;
  return false;
}

function exceedsDurationLimit(totalMs: number, config: RetryConfig): boolean {
  if (!config.limit?.duration) return false;
  const maxMs = durationToMs(config.limit.duration);
  return maxMs > 0 && totalMs > maxMs;
}

/**
 * Resolves the base delay from config.delay. When backoff is specified
 * but no explicit delay, defaults to 1 second — multiplying zero by a
 * backoff factor is never useful.
 */
function resolveBaseDelay(config: RetryConfig): number {
  if (config.delay) return durationToMs(config.delay);
  if (config.backoff) return DEFAULT_BASE_DELAY_MS;
  return 0;
}

/**
 * Computes the backoff multiplier for the given attempt.
 *
 * - constant: multiplier is always 1 (delay stays the same)
 * - exponential: 2^(attempt-1) — 1x, 2x, 4x, 8x, ...
 * - linear: attempt — 1x, 2x, 3x, 4x, ...
 * - no backoff: multiplier is 1
 */
function resolveBackoffMultiplier(
  attempt: number,
  backoff: BackoffConfig | undefined,
): number {
  if (!backoff) return 1;
  if (backoff.exponential) return Math.pow(2, attempt - 1);
  if (backoff.linear) return attempt;
  return 1;
}

/**
 * Computes jitter as a random value in [from, to] milliseconds.
 * When jitter is not configured, returns 0.
 */
function resolveJitter(config: RetryConfig): number {
  if (!config.jitter) return 0;

  const fromMs = config.jitter.from ? durationToMs(config.jitter.from) : 0;
  const toMs = config.jitter.to ? durationToMs(config.jitter.to) : 0;

  if (toMs <= fromMs) return fromMs;

  return fromMs + Math.random() * (toMs - fromMs);
}

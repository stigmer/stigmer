/**
 * HTTP error classification for side-channel proxy retries.
 *
 * The runner reaches stigmer-service's Side-Channel Proxy (`/v1/proxy/...`)
 * over plain `fetch` from several clients — the checkpoint saver today;
 * artifact storage, the LLM proxy, and the registry endpoint are candidates
 * (stigmer/stigmer#468). This module is the one place that answers "is this
 * HTTP failure worth retrying?", the `fetch` twin of grpc-retry.ts: it holds
 * the classification policy only, kept small and separately tested. The
 * bounded-backoff loop that consumes it lives with each client (the
 * grpc-retry/status.ts split).
 *
 * The policy is grounded in what the proxy actually emits, not HTTP folklore.
 * CheckpointerProxyController returns exactly four deterministic errors —
 * 400 (malformed document), 403 (FGA deny), 404 (no such checkpoint), and
 * 413 (the 4 MB cap) — and never a transient status. Transient failures
 * reach the runner only as 5xx (Spring's error handler, ingress 502-504),
 * 408/429 (infrastructure between runner and service), or as network-level
 * fetch rejections. 401/403 stay terminal deliberately: retrying cannot fix
 * an expired or rejected credential.
 */

/**
 * True for HTTP statuses that signal a transient condition worth retrying:
 * 408 (request timeout), 429 (throttled), and all 5xx. Every other status is
 * deterministic — the proxy's 4xx errors mean the same request will fail the
 * same way forever.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * True for `fetch` rejections that signal a transient transport condition:
 *
 * - `TypeError` — undici's network-failure shape (`fetch failed`, with the
 *   ECONNREFUSED/ECONNRESET/DNS cause attached). A deterministic TypeError
 *   (e.g. a malformed URL) also matches, which is accepted: such a bug fails
 *   every attempt including the first test run, and the bounded budget caps
 *   the wasted retries at seconds.
 * - `TimeoutError` — the rejection shape of `AbortSignal.timeout()`, i.e. a
 *   hung connection whose attempt we bounded ourselves.
 *
 * A manual abort (`AbortError`) is deliberately NOT retryable: the caller
 * cancelled on purpose.
 */
export function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof Error && err.name === "TimeoutError";
}

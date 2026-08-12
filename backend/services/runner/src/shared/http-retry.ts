/**
 * HTTP error classification AND the shared bounded-backoff loop for
 * side-channel proxy retries.
 *
 * The runner reaches stigmer-service's Side-Channel Proxy (`/v1/proxy/...`)
 * over plain `fetch` from several clients: the checkpoint saver, artifact
 * storage, and the model-registry fetches (stigmer/stigmer#468). This module
 * is the one place that answers "is this HTTP failure worth retrying?" — the
 * `fetch` twin of grpc-retry.ts — and, since #468, also owns the
 * {@link fetchWithRetry} loop those clients share. That is a deliberate
 * divergence from grpc-retry.ts's policy-only split: the gRPC side has a
 * single consumer whose loop is interwoven with persist-specific logic
 * (status.ts), while the HTTP side grew three consumers needing a
 * byte-identical loop — per-client copies were the drift risk, not the seam.
 *
 * The policy is grounded in what the proxy actually emits, not HTTP folklore.
 * CheckpointerProxyController returns exactly four deterministic errors —
 * 400 (malformed document), 403 (FGA deny), 404 (no such checkpoint), and
 * 413 (the 4 MB cap) — and never a transient status. Transient failures
 * reach the runner only as 5xx (Spring's error handler, ingress 502-504),
 * 408/429 (infrastructure between runner and service), or as network-level
 * fetch rejections. 401/403 stay terminal deliberately: retrying cannot fix
 * an expired or rejected credential. The same classification holds for the
 * presigned R2 URLs artifact storage talks to: their deterministic failures
 * (403 expired signature, 404 missing object) are 4xx, their transient ones
 * are 5xx/network.
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

/**
 * A fully-resolved retry policy for {@link fetchWithRetry}. Every field is
 * required on purpose: defaults differ per client (the checkpointer and the
 * presign endpoints run 30 s requests, artifact transfers 120 s, registry
 * fetches 10 s), so each client resolves its own defaults once and this
 * module never guesses.
 */
export interface FetchRetryPolicy {
  /** Client name for retry logs, e.g. "HttpCheckpointSaver". */
  readonly label: string;
  /** Delay before the first retry (ms); doubles per attempt via the factor. */
  readonly baseDelayMs: number;
  readonly backoffFactor: number;
  /** Retry attempts after the initial one. */
  readonly maxRetries: number;
  /**
   * Milliseconds before an in-flight request is aborted and the attempt is
   * classified retryable. Without it a hung connection (the realistic
   * unplanned-pod-kill symptom) stalls forever and the retry never engages.
   */
  readonly requestTimeoutMs: number;
  /** Injectable delay for tests; defaults to a real setTimeout sleep. */
  readonly delayFn?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` with bounded exponential backoff on transient failures and a
 * per-request abort timeout.
 *
 * Composition contract: on a non-retryable status — or when the budget is
 * exhausted on a retryable one — the last `Response` is RETURNED, so every
 * call site keeps its own `resp.ok` / 404 handling unchanged; this wrapper
 * changes when a response arrives, never what call sites do with it. It
 * throws only what `fetch` itself throws: a network-level rejection that is
 * non-retryable or has exhausted the budget.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  policy: FetchRetryPolicy,
): Promise<Response> {
  const delay = policy.delayFn ?? defaultDelay;
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < policy.maxRetries;
    let resp: Response;
    try {
      resp = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(policy.requestTimeoutMs),
      });
    } catch (err) {
      if (canRetry && isRetryableFetchError(err)) {
        await backOff(policy, delay, attempt, String(err));
        continue;
      }
      throw err;
    }
    if (canRetry && isRetryableHttpStatus(resp.status)) {
      await backOff(policy, delay, attempt, `HTTP ${resp.status} ${resp.statusText}`);
      continue;
    }
    return resp;
  }
}

async function backOff(
  policy: FetchRetryPolicy,
  delay: (ms: number) => Promise<void>,
  attempt: number,
  reason: string,
): Promise<void> {
  const delayMs = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt);
  console.warn(
    `[${policy.label}] retryable failure ` +
    `(attempt ${attempt + 1}/${policy.maxRetries + 1}, retry in ${delayMs}ms): ${reason}`,
  );
  await delay(delayMs);
}

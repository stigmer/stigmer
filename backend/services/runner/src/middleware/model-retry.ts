/**
 * Tries a model reply again when it failed after it began: the one failure
 * LangChain's client retry never sees.
 *
 * LangChain's retry wraps only the request: it resolves when the provider's
 * response headers arrive, and the streamed events are read after it. So an
 * `event: error` after a 200 (an overload that arrives once the reply has
 * started, Bedrock's exception frames) or a connection cut mid-reply ends
 * the call with nothing to try it again. This middleware is that second
 * chance, and only that: it retries what `shared/model-retry.ts` calls
 * retryable, and that rule stops on every error the request loop has
 * stamped as handled, so a failure is never retried by both loops.
 *
 * At most {@link MODEL_STREAM_RETRIES} times, on the request loop's first
 * waits (1-2 s, then 2-4 s), never shorter than the provider's retry-after,
 * and the wait ends at once when the run is stopped (the call's own signal,
 * which a stop aborts). Each retry is a whole new call: its own request
 * retries, a fresh reply. A partial reply already on the person's screen
 * stays there and the fresh one follows it; the model never sees the
 * partial, because the graph keeps only the message a call returns. A
 * failed call reports no usage, so nothing is counted twice.
 *
 * Last in Stigmer's stacks (`middleware/index.ts`, `subagent-wiring.ts`):
 * a retry re-runs none of Stigmer's own bookkeeping (loop detection, the
 * round budget, the cost advisory), and the call's one OTel span covers its
 * attempts. deepagents' own tail (prompt caching, memory) sits inside it and
 * re-shapes each attempt's request, which is all it does.
 *
 * Each failed attempt leaves one line, no message, key or content (the
 * `[TRUNCATED]` precedent): `[MODEL-RETRY] phase=stream decision=<retry|stop>
 * reason=<reason> attempt=<n>/<max> delay_ms=<n|none>`. A failure the request
 * loop already handled logged its own line there and logs none here.
 */

import { MODEL_STREAM_RETRIES, handledByRequestLoop, retryDecisionOf } from "../shared/model-retry.js";
import type { StigmerMiddleware } from "./types.js";

export interface ModelRetryConfig {
  /** Retries after the first call; defaults to {@link MODEL_STREAM_RETRIES}. */
  readonly maxRetries: number;
  /** The wait between calls, ended by the signal; a real timer by default, replaced in tests. */
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** The spread of each wait, 0 to 1; `Math.random` by default. */
  readonly random: () => number;
}

/** The wait before retry `retry` (1-based): p-retry's 1 s start, factor 2, 1x to 2x spread, never shorter than the provider's hint. */
export function streamRetryDelayMs(retry: number, retryAfterMs: number | undefined, random: () => number): number {
  const delay = Math.round((1 + random()) * 1_000 * 2 ** (retry - 1));
  return Math.max(delay, retryAfterMs ?? 0);
}

export function createModelRetryMiddleware(config: Partial<ModelRetryConfig> = {}): StigmerMiddleware {
  const maxRetries = config.maxRetries ?? MODEL_STREAM_RETRIES;
  const sleep = config.sleep ?? sleepUnlessAborted;
  const random = config.random ?? Math.random;
  const maxAttempts = maxRetries + 1;

  return {
    name: "ModelRetryMiddleware",
    async wrapModelCall(request, handler) {
      const signal = (request.runtime as { signal?: AbortSignal } | undefined)?.signal;
      for (let attempt = 1; ; attempt++) {
        try {
          return await handler(request);
        } catch (err) {
          const decision = retryDecisionOf(err);
          if (!decision.retry || attempt >= maxAttempts) {
            if (!handledByRequestLoop(err)) {
              console.warn(
                `[MODEL-RETRY] phase=stream decision=stop reason=${decision.reason} attempt=${attempt}/${maxAttempts} delay_ms=none`,
              );
            }
            throw err;
          }
          const delayMs = streamRetryDelayMs(attempt, decision.retryAfterMs, random);
          console.warn(
            `[MODEL-RETRY] phase=stream decision=retry reason=${decision.reason} attempt=${attempt}/${maxAttempts} delay_ms=${delayMs}`,
          );
          await sleep(delayMs, signal);
        }
      }
    },
  };
}

/** Resolves after `ms`, or rejects with the stop the moment the signal aborts. */
function sleepUnlessAborted(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErrorOf(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortErrorOf(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The stop as an error, the way the graph's own race against the signal
 * throws it: the runtime aborts with a string reason. Twinned from
 * `@langchain/core` (`dist/utils/signal.js` `getAbortSignalError`, 1.2.13),
 * which does not export it.
 */
export function abortErrorOf(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(typeof signal.reason === "string" ? signal.reason : "Aborted");
}

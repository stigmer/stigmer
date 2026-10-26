/**
 * The download retry contract every artifact fetch runs under.
 *
 * A connection that resets before or during the body, a 5xx or a 429 is tried
 * again with a doubling wait, so a network blip does not fail a first
 * `stigmer up`, a CI lane, an image build or a person's first Claude turn. Any
 * other HTTP status is an answer and fails at once. The body is read inside
 * the attempt, so a connection that drops after the headers is as transient as
 * one that never connects. An abort is never retried: the caller asked to
 * stop.
 */

import { setTimeout as delay } from "node:timers/promises";
import { ArtifactFetchError } from "./errors.js";

/** Attempts per download before a transient failure is reported. */
export const DOWNLOAD_ATTEMPTS = 4;

/** The wait before the second attempt; it doubles before each later one (1 s, 2 s, 4 s). */
export const DOWNLOAD_RETRY_BASE_DELAY_MS = 1_000;

/** The network a download runs over: the fetch it calls and the wait between attempts. */
export interface Network {
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
}

/** The process's network, with either half replaced (tests). */
export function network(overrides: { readonly fetchImpl?: typeof fetch; readonly sleep?: (ms: number) => Promise<void> } = {}): Network {
  return { fetch: overrides.fetchImpl ?? fetch, sleep: overrides.sleep ?? ((ms) => delay(ms)) };
}

/**
 * One download of `url`, retried by the contract above, with `read` consuming
 * the response inside each attempt. `label` names the artifact in the error.
 * `signal`, when given, is passed to the fetch; once it aborts, its reason is
 * thrown as is, never retried and never wrapped.
 */
export async function fetchWithRetry<T>(
  net: Network,
  url: string,
  label: string,
  read: (res: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let lastFailure = "";
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    if (attempt > 1) await net.sleep(DOWNLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 2));
    signal?.throwIfAborted();

    let res: Response;
    try {
      res = await net.fetch(url, signal === undefined ? undefined : { signal });
    } catch (err) {
      signal?.throwIfAborted();
      lastFailure = describeFailure(err);
      continue;
    }
    if (!res.ok) {
      if (!isTransientStatus(res.status)) {
        throw new ArtifactFetchError(`failed to download ${label}: HTTP ${res.status} from ${url}`);
      }
      lastFailure = `HTTP ${res.status}`;
      continue;
    }
    try {
      return await read(res);
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof ArtifactFetchError) throw err;
      lastFailure = describeFailure(err);
    }
  }
  throw new ArtifactFetchError(`failed to download ${label} from ${url} after ${DOWNLOAD_ATTEMPTS} attempts: ${lastFailure}`, [
    "check the network connection, then run the command again",
  ]);
}

// A server error or a rate limit may clear on its own; any other status will not.
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/** An error as one line, with Node fetch's socket error behind "fetch failed" appended. */
export function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
}

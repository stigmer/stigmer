/**
 * The transport the runner hands LangChain's Google client: the one place a
 * Gemini request gets its credential and its time bound.
 *
 * `ChatGoogle` sends every request through an `apiClient`, and builds its
 * own (`WebApiClient`) only when it is handed none. That client reads
 * `GOOGLE_API_KEY` from the environment when given no key, falls back to
 * Google Cloud credentials when there is none, and is the library's
 * documented seam for custom authentication. The runner always hands it this
 * one instead, so:
 *
 *  - The credential is chosen by where the call goes, never read from the
 *    environment. A call to Google carries the operator's key in
 *    `x-goog-api-key`. A call to a Stigmer endpoint (the platform's proxy,
 *    or a lane of the runner's local proxy) carries `Authorization: Bearer`
 *    and the scope headers (`llm-proxy.ts` `buildProxyHeaders`), the
 *    credential every other provider's Stigmer call carries, so neither
 *    proxy reads a third credential header.
 *  - The headers are added here, beneath the client. The client copies its
 *    own custom headers into a `google-request-*` callback event with the
 *    URL and the body before each call; headers a transport adds never
 *    reach that event, so no credential or execution id does.
 *  - The per-attempt bound (`STIGMER_LLM_REQUEST_TIMEOUT_MS`) is armed around
 *    the fetch and cleared when the response headers arrive, the semantics
 *    `model-client.ts` states for the other SDKs; the client has no timeout
 *    of its own. A timed-out attempt fails with an error named
 *    `TimeoutError`, which `model-retry.ts` and `model-error.ts` read as a
 *    model connection timeout.
 *
 * The client is typed through `ChatGoogleParams["apiClient"]`, a type-only
 * import, so this module loads no part of the library.
 */

import type { ChatGoogleParams } from "@langchain/google";

/** The client's transport seam: an object with `fetch`, `hasApiKey` and `getProjectId`. */
export type GoogleApiClient = NonNullable<ChatGoogleParams["apiClient"]>;

/** The header Google's Gemini API reads its key from. */
export const GOOGLE_API_KEY_HEADER = "x-goog-api-key";

/** Google's Gemini API. The client puts the API version and `/models/<id>:<method>` after it. */
export const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com";

/**
 * The Gemini API version the runner calls, pinned rather than left to the
 * client's default: it is part of the path every Stigmer endpoint serves
 * (`/v1/proxy/llm/google/v1beta/models/...`) and the local proxy's Google
 * lane allows.
 */
export const GEMINI_API_VERSION = "v1beta";

/** Where a request goes, and so which credential it carries. */
export type GoogleCredential =
  | { readonly kind: "google-key"; readonly key: string }
  | { readonly kind: "stigmer"; readonly headers: Readonly<Record<string, string>> };

export interface GoogleTransportOptions {
  readonly credential: GoogleCredential;
  /** The per-attempt bound, in milliseconds; omitted, an attempt is unbounded. */
  readonly timeoutMs?: number;
}

/** A transport for `ChatGoogle` (the module header). */
export function googleTransport(options: GoogleTransportOptions): GoogleApiClient {
  const credentialHeaders: Readonly<Record<string, string>> =
    options.credential.kind === "google-key"
      ? { [GOOGLE_API_KEY_HEADER]: options.credential.key }
      : options.credential.headers;
  return {
    // The client asks only to pick a platform when none is set; the runner
    // always sets the Gemini API, and every request carries a credential.
    hasApiKey: () => true,
    // Read only for a Vertex location path, which the runner never builds.
    getProjectId: async () => "",
    fetch: (request: Request) => boundedFetch(withHeaders(request, credentialHeaders), options.timeoutMs),
  };
}

function withHeaders(request: Request, extra: Readonly<Record<string, string>>): Request {
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Request(request, { headers });
}

/** The fetch, bounded until its response headers arrive; the caller's own abort still wins. */
async function boundedFetch(request: Request, timeoutMs: number | undefined): Promise<Response> {
  if (timeoutMs === undefined) return fetch(request);
  const bound = new AbortController();
  const timer = setTimeout(() => bound.abort(timeoutError(timeoutMs)), timeoutMs);
  try {
    return await fetch(request, { signal: AbortSignal.any([request.signal, bound.signal]) });
  } finally {
    clearTimeout(timer);
  }
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`the model request sent no response within ${timeoutMs} ms`);
  error.name = "TimeoutError";
  return error;
}

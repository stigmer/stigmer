/**
 * What an MCP endpoint says to a caller without a credential, read from one
 * `initialize` and its status line and headers alone.
 *
 * Two processes ask this question and both need the same answer: the
 * control plane at save time (does this URL-only server need Sign in, so
 * the button appears before anyone runs it) and the runner at the first
 * failed tool call (was that failure an OAuth requirement, so the user is
 * told to sign in instead of to check a token). The catalogue audit asks
 * it too, and then keeps asking (`tools/list`, the SSE arm, the metadata
 * walk) because it measures; those extra moves are the audit's, built on
 * `request.ts` and `metadata.ts`, not this function's.
 *
 * The outcome vocabulary is closed and says only what the wire said. A 2xx
 * is `accepted`: the handshake was not refused for want of a credential,
 * and whether the body carried a result or a JSON-RPC error is not this
 * reader's question (both mean "not OAuth" to its callers). The body is
 * cancelled unread, so a server that streams its answer over an event
 * stream that never closes cannot hold the probe open. Only a 401 enters
 * the OAuth rule (`challenge.ts`).
 *
 * Never throws: a network failure, an abort or a deadline is `unreachable`,
 * because a caller that saves a resource or classifies a failure must not
 * fail on a probe. No redirect is followed by the probe itself; the fetch
 * it is handed decides that (the control plane's guarded fetch follows and
 * re-judges each hop, the runner's `fetch` follows). The caller sets the
 * deadline: 3 s on a user's save, 10 s on the runner's failure path.
 *
 * Proven by __tests__/probe.test.ts.
 */
import type { OutboundFetch } from "../egress/fetch.js";
import { isOAuthChallenge, parseResourceMetadataUrl } from "./challenge.js";
import { initializeRequest } from "./request.js";

export type EndpointAuthOutcome =
  /** A 401 the OAuth rule accepts: the endpoint wants an OAuth token and says where its login server is described. */
  | { readonly kind: "oauth"; readonly challenge: string; readonly resourceMetadataUrl: string | undefined }
  /** A 401 the rule refuses: a static-token API's bad-key answer, or a proxy asking for its own credential. */
  | { readonly kind: "challenge-not-oauth"; readonly challenge: string }
  /** A 2xx: the handshake was not refused for want of a credential. */
  | { readonly kind: "accepted"; readonly status: number }
  /** Any other HTTP status. */
  | { readonly kind: "http-other"; readonly status: number }
  /** No HTTP answer: a network failure, a refusal by the fetch, or the deadline. */
  | { readonly kind: "unreachable"; readonly error: string };

export interface EndpointProbeDeps {
  readonly fetchImpl: OutboundFetch;
  /** The whole probe's deadline, connection and headers included. */
  readonly timeoutMs: number;
  /** Who is asking, for the handshake's `clientInfo`. */
  readonly clientName: string;
}

/** Ask an endpoint once, with the caller's headers, and say what it answered. */
export async function probeEndpointAuth(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  deps: EndpointProbeDeps,
): Promise<EndpointAuthOutcome> {
  const request = initializeRequest(deps.clientName, headers);
  let response: Response;
  try {
    response = await deps.fetchImpl(url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (error) {
    return { kind: "unreachable", error: describeError(error) };
  }

  // Only the status line and the headers classify; the body is released so
  // an endless event stream cannot hold the probe open.
  await response.body?.cancel().catch(() => undefined);

  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? "";
    if (!isOAuthChallenge(challenge)) return { kind: "challenge-not-oauth", challenge };
    return { kind: "oauth", challenge, resourceMetadataUrl: parseResourceMetadataUrl(challenge) };
  }
  if (response.status >= 200 && response.status < 300) {
    return { kind: "accepted", status: response.status };
  }
  return { kind: "http-other", status: response.status };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

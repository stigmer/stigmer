/**
 * The guarded fetch: a `fetch`-shaped function that judges every URL it is
 * about to dial, including every redirect hop, under one egress policy.
 *
 * A process composes exactly one of these at its root and hands it to
 * every module that dials a user-supplied URL, so an unguarded call cannot
 * be written by omission: the module holds no `fetch` of its own, only the
 * `OutboundFetch` it was given. Tests hand a fake in the same shape.
 *
 * Redirects are the reason this is a wrapper and not a pre-check. The
 * platform's own `fetch` would follow a redirect to an internal address
 * after the first hop passed, so redirects are always requested `manual`
 * from the underlying fetch and followed here, each hop judged like the
 * first, up to `maxRedirects` (3, enough for a scheme upgrade and a
 * trailing-slash canonicalisation with one to spare). A caller that asked
 * for `redirect: "manual"` gets the 3xx back untouched (the OAuth preflight
 * wants exactly that); `redirect: "error"` is honoured by throwing the same
 * TypeError `fetch` throws. On a cross-origin hop the `Authorization`
 * header is dropped, as the fetch standard does, so a credential meant for
 * one host never travels to another. A 303, or a 301/302 answering a
 * non-GET, becomes a GET without a body; 307 and 308 keep method and body.
 *
 * `OutboundFetch` takes a string or a URL, never a `Request`: a Request
 * carries its own headers and body that a wrapper would have to merge, and
 * no caller here builds one. The global `fetch` is assignable to it, so a
 * test or a script can pass `fetch` where the guard is not the point.
 *
 * Proven by __tests__/fetch.test.ts.
 */
import type { EgressPolicy } from "./address.js";
import { checkEgress, EgressError, type LookupFn } from "./check.js";

/** The fetch shape every outbound-dialling module takes; the global `fetch` satisfies it. */
export type OutboundFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface GuardedFetchOptions {
  readonly fetchImpl: OutboundFetch;
  readonly lookup: LookupFn;
  /** Hops followed before refusing; default 3. */
  readonly maxRedirects?: number;
}

/** The default hop budget: a scheme upgrade and a canonicalisation, with one to spare. */
export const DEFAULT_MAX_REDIRECTS = 3;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * An `OutboundFetch` in the global `fetch`'s shape, for a seam typed
 * `typeof fetch`. A `Request` input is refused rather than flattened: this
 * library's callers pass URLs, and a wrapper that silently dropped a
 * Request's body or headers would be a bug that looked like a network
 * failure.
 */
export function asFetch(outbound: OutboundFetch): typeof fetch {
  return (input, init) => {
    if (typeof input === "string" || input instanceof URL) return outbound(input, init);
    return Promise.reject(new TypeError("OutboundFetch takes a URL, not a Request"));
  };
}

/** Compose a fetch that judges every URL and every hop under `policy`. */
export function guardedFetch(policy: EgressPolicy, options: GuardedFetchOptions): OutboundFetch {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return async (input, init) => {
    let url = new URL(input);
    let method = (init?.method ?? "GET").toUpperCase();
    let body = init?.body;
    const headers = new Headers(init?.headers);
    const callerRedirect = init?.redirect ?? "follow";

    for (let hop = 0; ; hop += 1) {
      const check = await checkEgress(url, policy, { lookup: options.lookup, signal: init?.signal });
      if (!check.ok) throw new EgressError(check.refusal);

      const response = await options.fetchImpl(url, { ...init, method, body, headers, redirect: "manual" });

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || location === null || callerRedirect === "manual") {
        return response;
      }
      if (callerRedirect === "error") {
        await response.body?.cancel();
        throw new TypeError(`fetch refused to follow a redirect from ${url.href}`);
      }
      if (hop >= maxRedirects) {
        await response.body?.cancel();
        throw new EgressError({ kind: "too-many-redirects", url, hops: maxRedirects });
      }

      await response.body?.cancel();
      const next = new URL(location, url);
      if (next.origin !== url.origin) headers.delete("authorization");
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
      url = next;
    }
  };
}

/**
 * The egress check: may this process dial this URL under this policy?
 *
 * The answer is a value, not a throw, so a caller can render its own
 * sentence (the runner tells a model "this runner does not fetch from", the
 * control plane tells a user what the endpoint resolved to) while the
 * judgement itself has one home. `EgressError` wraps a refusal for the
 * callers that want a throw (the guarded fetch).
 *
 * The check resolves the hostname and judges EVERY address it resolves to:
 * a name with one public and one private record must be refused, or the
 * private record becomes the bypass. Literal IP hosts are judged as they
 * are, without a lookup. Resolution is injected (`LookupFn`) so tests never
 * touch DNS, and it races the caller's `signal`: `dns.lookup` has no
 * timeout of its own, and a save that waits on a hanging resolver would be
 * a save that hangs (the control plane's probe runs under one deadline
 * that covers resolution, for exactly this reason). An aborted signal
 * propagates as the signal's reason, the way `fetch` itself behaves.
 *
 * Accepted limitation, inherited from the runner's guard: a DNS-rebinding
 * window remains between our lookup and the socket connect. Node's fetch
 * (undici) offers no lookup pinning without replacing the dispatcher, and
 * the strict posture's range refusals make the rebinding payoff (an
 * internal address) unreachable anyway.
 *
 * Proven by __tests__/check.test.ts.
 */
import { isIP } from "node:net";

import type { EgressPolicy } from "./address.js";

/** Resolve a hostname to every address it has; rejects when it has none. */
export type LookupFn = (hostname: string) => Promise<readonly string[]>;

/** Why a URL was refused; one shape per cause, each carrying what a sentence needs. */
export type EgressRefusal =
  | { readonly kind: "invalid-url"; readonly url: string }
  | { readonly kind: "unsupported-scheme"; readonly url: URL; readonly scheme: string }
  | { readonly kind: "unresolvable"; readonly url: URL; readonly hostname: string }
  | {
      readonly kind: "blocked";
      readonly url: URL;
      readonly hostname: string;
      readonly address: string;
      readonly reason: string;
      readonly policy: string;
    }
  | { readonly kind: "too-many-redirects"; readonly url: URL; readonly hops: number };

export type EgressCheck =
  | { readonly ok: true; readonly url: URL; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly refusal: EgressRefusal };

export interface EgressCheckOptions {
  readonly lookup: LookupFn;
  /** Bounds the resolution; an abort propagates as the signal's reason. */
  readonly signal?: AbortSignal | null | undefined;
}

/** One sentence per refusal, safe to show a user or a model. */
export function describeRefusal(refusal: EgressRefusal): string {
  switch (refusal.kind) {
    case "invalid-url":
      return `Invalid URL: ${refusal.url}`;
    case "unsupported-scheme":
      return `Unsupported URL scheme "${refusal.scheme}": only http and https are allowed.`;
    case "unresolvable":
      return `Could not resolve hostname: ${refusal.hostname}`;
    case "blocked":
      return `Refusing to reach ${refusal.hostname}: it resolves to ${refusal.address}, a ${refusal.reason} address the ${refusal.policy} egress policy does not dial.`;
    case "too-many-redirects":
      return `Refusing to follow more than ${refusal.hops} redirects from ${refusal.url.href}.`;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
}

/** A refusal as a throwable, for callers that want one. */
export class EgressError extends Error {
  constructor(readonly refusal: EgressRefusal) {
    super(describeRefusal(refusal));
    this.name = "EgressError";
  }
}

/** Judge a URL under a policy: scheme, then every resolved address. */
export async function checkEgress(rawUrl: string | URL, policy: EgressPolicy, options: EgressCheckOptions): Promise<EgressCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, refusal: { kind: "invalid-url", url: String(rawUrl) } };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, refusal: { kind: "unsupported-scheme", url, scheme: url.protocol.replace(/:$/, "") } };
  }

  const addresses = await resolveAddresses(url.hostname, options);
  if (addresses === undefined) {
    return { ok: false, refusal: { kind: "unresolvable", url, hostname: url.hostname } };
  }

  for (const address of addresses) {
    const reason = policy.blockedReason(address);
    if (reason !== null) {
      return { ok: false, refusal: { kind: "blocked", url, hostname: url.hostname, address, reason, policy: policy.name } };
    }
  }

  return { ok: true, url, addresses };
}

/**
 * Every address a hostname has. Literal IPs pass through (a bracketed IPv6
 * host arrives from URL.hostname still bracketed). `undefined` when the name
 * does not resolve; an aborted signal throws its reason.
 */
async function resolveAddresses(hostname: string, options: EgressCheckOptions): Promise<readonly string[] | undefined> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0) {
    return [literal];
  }
  try {
    const records = await raceSignal(options.lookup(hostname), options.signal);
    return records.length === 0 ? undefined : records;
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    return undefined;
  }
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (signal === null || signal === undefined) return promise;
  if (signal.aborted) {
    // The resolver was already asked; its eventual answer is nobody's now.
    promise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      promise.catch(() => undefined);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

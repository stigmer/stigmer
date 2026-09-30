/**
 * The egress check: may this process dial this URL under this policy?
 *
 * The answer is a value, not a throw, so a caller can render its own
 * sentence (the runner tells a model "this runner does not fetch from", the
 * control plane tells a user why it will not dial) while the judgement
 * itself has one home. `EgressError` wraps a refusal for the callers that
 * want a throw (the guarded fetch).
 *
 * What a sentence may say depends on the posture. Under strict, the process
 * resolves names through a network the caller does not own (a hosted
 * cluster's DNS), so a sentence that named the address a name resolved to,
 * or told "does not resolve" apart from "resolves to a refused address",
 * would answer whether an internal hostname exists and where it points. A
 * strict refusal of either kind reads as one sentence that names neither;
 * the refusal value keeps the address and the reason for the caller's log.
 * A literal IP host resolved nothing and is the caller's own input, so its
 * refusal still names the range it falls in.
 * Under relaxed the network is the operator's own, and the detail is theirs.
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

import type { EgressPolicy, EgressPosture } from "./address.js";

/** Resolve a hostname to every address it has; rejects when it has none. */
export type LookupFn = (hostname: string) => Promise<readonly string[]>;

/** Why a URL was refused; one shape per cause, each carrying what a sentence needs. */
export type EgressRefusal =
  | { readonly kind: "invalid-url"; readonly url: string }
  | { readonly kind: "unsupported-scheme"; readonly url: URL; readonly scheme: string }
  | { readonly kind: "unresolvable"; readonly url: URL; readonly hostname: string; readonly policy: EgressPosture }
  | {
      readonly kind: "blocked";
      readonly url: URL;
      readonly hostname: string;
      readonly address: string;
      readonly reason: string;
      readonly policy: EgressPosture;
    }
  | { readonly kind: "too-many-redirects"; readonly url: URL; readonly hops: number }
  | { readonly kind: "response-too-large"; readonly url: URL; readonly maxBytes: number };

export type EgressCheck =
  | { readonly ok: true; readonly url: URL; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly refusal: EgressRefusal };

export interface EgressCheckOptions {
  readonly lookup: LookupFn;
  /** Bounds the resolution; an abort propagates as the signal's reason. */
  readonly signal?: AbortSignal | null | undefined;
}

/**
 * One sentence per refusal, safe to show a user or a model: under the strict
 * posture an unresolvable name and a refused address read alike (the module
 * header says why).
 */
export function describeRefusal(refusal: EgressRefusal): string {
  switch (refusal.kind) {
    case "invalid-url":
      return `Invalid URL: ${refusal.url}`;
    case "unsupported-scheme":
      return `Unsupported URL scheme "${refusal.scheme}": only http and https are allowed.`;
    case "unresolvable":
      return refusalWithholdsResolution(refusal)
        ? noPublicAddress(refusal.hostname)
        : `Could not resolve hostname: ${refusal.hostname}`;
    case "blocked":
      return refusalWithholdsResolution(refusal)
        ? noPublicAddress(refusal.hostname)
        : `Refusing to reach ${refusal.hostname}: it resolves to ${refusal.address}, a ${refusal.reason} address the ${refusal.policy} egress policy does not dial.`;
    case "too-many-redirects":
      return `Refusing to follow more than ${refusal.hops} redirects from ${refusal.url.href}.`;
    case "response-too-large":
      return `Refusing to read more than ${refusal.maxBytes} bytes from ${refusal.url.href}.`;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
}

/**
 * Whether a refusal's sentence must withhold what resolution found: a strict
 * refusal of a name (unresolvable, or resolved to a refused address). Every
 * caller that renders its own sentence asks this, so the rule has one home.
 */
export function refusalWithholdsResolution(refusal: EgressRefusal): boolean {
  switch (refusal.kind) {
    case "unresolvable":
      return refusal.policy === "strict";
    case "blocked":
      return refusal.policy === "strict" && !isLiteralHost(refusal.hostname);
    case "invalid-url":
    case "unsupported-scheme":
    case "too-many-redirects":
    case "response-too-large":
      return false;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
}

/** The strict posture's one sentence for a name it will not dial: true of both causes, naming neither. */
function noPublicAddress(hostname: string): string {
  return `Refusing to reach ${hostname}: it does not resolve to a public address.`;
}

/** Whether a URL's host is an IP literal (a bracketed IPv6 host arrives from URL.hostname still bracketed). */
function isLiteralHost(hostname: string): boolean {
  return isIP(hostname.replace(/^\[|\]$/g, "")) !== 0;
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
    return { ok: false, refusal: { kind: "unresolvable", url, hostname: url.hostname, policy: policy.name } };
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
  if (isLiteralHost(hostname)) {
    return [hostname.replace(/^\[|\]$/g, "")];
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

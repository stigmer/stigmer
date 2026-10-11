/**
 * The pinned dialer: an `OutboundFetch` whose every socket opens to an
 * address it judged, under the same policy and rule as the egress check.
 *
 * Importing this module loads undici, and undici registers itself as the
 * process's dispatcher on import (the slot Node's built-in `fetch` reads)
 * when nothing registered one first. A Stigmer server process already
 * carries undici from its Kubernetes client, so nothing changes there; a
 * process without it (the runner) would change every `fetch` it makes by
 * importing this. That is why the dialer is its own entry,
 * `@stigmer/outbound/dial`, on neither the root barrel nor `./egress`, and
 * why `package.json` lists it as the library's one module with side effects.
 *
 * Why it exists: the guarded fetch (`../egress/fetch.ts`) checks a URL's
 * addresses and then asks a `fetch` to dial its hostname, which resolves
 * the name again. A name that answers public to the check and private to
 * the socket (DNS rebinding) would reach the address the check refused.
 * Here the resolution that feeds the socket is the judged one: an undici
 * `Agent` whose connector resolves through the injected `LookupFn`, judges
 * every address with `refusedAddress`, and hands the socket only judged
 * addresses. Any refused address refuses the dial, as the check does; a
 * name that resolves to nothing, or a resolver that fails, refuses it as
 * unresolvable. A literal IP host resolves nothing, so the connector judges
 * it as it stands. The connector sits under every connection the Agent
 * makes, so a redirect undici follows itself is judged too. A resolver
 * that hangs is bounded by undici's connect timeout and the request's own
 * signal. TLS is untouched: the lookup decides which IP a socket opens,
 * never the server name, and the certificate is still checked against the
 * URL's host.
 *
 * A connect-time refusal comes back as the same `EgressError` the check
 * throws (`blocked` or `unresolvable`, for the URL this dialer was asked
 * for), so every caller's refusal arm answers a rebinding exactly as a
 * refused name and the strict posture's sentence withholds the address as
 * before. Any other failure (a refused port, a TLS error) stays the
 * platform's `TypeError`.
 *
 * It dials with undici's own `fetch` and Agent, never the platform `fetch`
 * with this Agent as its dispatcher: undici 8 and the undici a Node 22
 * bundles speak different handler interfaces, and the pairing fails at run
 * time. The two `fetch`es do not share request and response types either,
 * so an explicit adapter sits at the boundary. It carries the method,
 * headers, redirect mode and signal, and the bodies this library's callers
 * send (a string, form parameters, bytes); any other body is refused before
 * a connection opens, the way `asFetch` refuses a `Request`. The answer is
 * rebuilt as a platform `Response`.
 *
 * `nodeGuardedFetch` is how a process composes it: the guarded fetch over
 * this dialer, both judging under one policy and one resolver, so the
 * check and the connect cannot disagree by construction.
 *
 * Proven by __tests__/pinned-fetch.test.ts, against a real server.
 */
import { isIP, type LookupFunction } from "node:net";

import { Agent, buildConnector, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

import type { EgressPolicy } from "../egress/address.js";
import { EgressError, refusedAddress, type LookupFn, type RefusedAddress } from "../egress/check.js";
import { guardedFetch, type OutboundFetch } from "../egress/fetch.js";
import { nodeLookup } from "../egress/node-lookup.js";

export interface PinnedFetchOptions {
  readonly lookup: LookupFn;
}

export interface NodeGuardedFetchOptions {
  /** The dial under the guard; default the pinned dialer. The composition roots' test seam. */
  readonly fetchImpl?: OutboundFetch;
  /** The resolver both the check and the connect use; default the process's own. */
  readonly lookup?: LookupFn;
  /** Hops followed before refusing; the guarded fetch's default when absent. */
  readonly maxRedirects?: number;
  /** Bytes of a response body read before refusing; the guarded fetch's default when absent. */
  readonly maxResponseBytes?: number;
}

/**
 * Why the connector refused a socket. Module-private: `pinnedFetch` finds it
 * in the failed fetch's `cause` and answers with an `EgressError`, because
 * only it knows the URL the refusal is about.
 */
class ConnectRefusal extends Error {
  constructor(
    readonly hostname: string,
    readonly refused: RefusedAddress | null,
  ) {
    super(refused === null ? `${hostname} has no address to dial` : `${hostname} resolves to a refused address`);
    this.name = "ConnectRefusal";
  }
}

/** The guarded fetch over the pinned dialer: what a process composes at its root. */
export function nodeGuardedFetch(policy: EgressPolicy, options: NodeGuardedFetchOptions = {}): OutboundFetch {
  const lookup = options.lookup ?? nodeLookup();
  return guardedFetch(policy, {
    fetchImpl: options.fetchImpl ?? pinnedFetch(policy, { lookup }),
    lookup,
    maxRedirects: options.maxRedirects,
    maxResponseBytes: options.maxResponseBytes,
  });
}

/** A fetch whose every socket opens only to an address `policy` allows, as `lookup` resolved it. */
export function pinnedFetch(policy: EgressPolicy, options: PinnedFetchOptions): OutboundFetch {
  const connect = buildConnector({ lookup: judgingLookup(policy, options.lookup) });
  const agent = new Agent({
    connect: (connectOptions, callback) => {
      // undici hands an IPv6 literal without its brackets; a literal host never reaches the lookup.
      if (isIP(connectOptions.hostname) !== 0) {
        const refused = refusedAddress([connectOptions.hostname], policy);
        if (refused !== null) {
          callback(new ConnectRefusal(connectOptions.hostname, refused), null);
          return;
        }
      }
      connect(connectOptions, callback);
    },
  });

  return async (input, init) => {
    const url = new URL(input);
    const request = undiciInit(init);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, { ...request, dispatcher: agent });
    } catch (error) {
      const refusal = connectRefusalIn(error);
      if (refusal === undefined) throw error;
      throw new EgressError(
        refusal.refused === null
          ? { kind: "unresolvable", url, hostname: refusal.hostname, policy: policy.name }
          : { kind: "blocked", url, hostname: refusal.hostname, ...refusal.refused, policy: policy.name },
      );
    }
    // undici answers a null body for the null-body statuses (204, 205, 304)
    // itself, as the fetch standard says, so the platform Response accepts it.
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    });
  };
}

/**
 * A Node lookup that resolves through `lookup`, judges every address, and
 * answers only with judged ones. It honours the options a socket passes:
 * `all` (a list, which `autoSelectFamily` asks for) or one address, and
 * `family` as a filter over the judged list that never widens it. Exported
 * for its tests; a process takes it through `pinnedFetch`.
 */
export function judgingLookup(policy: EgressPolicy, lookup: LookupFn): LookupFunction {
  return (hostname, options, callback) => {
    void judge(hostname, familyNumber(options.family), policy, lookup).then((judged) => {
      if (judged instanceof ConnectRefusal) {
        callback(judged, "", 0);
      } else if (options.all === true) {
        callback(
          null,
          judged.all.map((address) => ({ address, family: isIP(address) })),
        );
      } else {
        callback(null, judged.first, isIP(judged.first));
      }
    });
  };
}

/** The addresses a socket may open for `hostname`, or why it may open none. */
async function judge(
  hostname: string,
  family: number,
  policy: EgressPolicy,
  lookup: LookupFn,
): Promise<{ readonly first: string; readonly all: readonly string[] } | ConnectRefusal> {
  let addresses: readonly string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return new ConnectRefusal(hostname, null);
  }
  const refused = refusedAddress(addresses, policy);
  if (refused !== null) return new ConnectRefusal(hostname, refused);
  const all = family === 0 ? addresses : addresses.filter((address) => isIP(address) === family);
  const [first] = all;
  if (first === undefined) return new ConnectRefusal(hostname, null);
  return { first, all };
}

/** A lookup's `family` option as 0 (any), 4 or 6. */
function familyNumber(family: number | "IPv4" | "IPv6" | undefined): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family ?? 0;
}

/** The connector's refusal behind a failed fetch: undici reports a failed connect as `TypeError("fetch failed")` with the connector's error as its cause. */
function connectRefusalIn(error: unknown): ConnectRefusal | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof ConnectRefusal) return current;
    current = current.cause;
  }
  return undefined;
}

/**
 * The platform request as undici's: the fields this library's callers set.
 * A body other than a string, form parameters or bytes is refused here,
 * before any connection, rather than flattened.
 */
function undiciInit(init: RequestInit | undefined): UndiciRequestInit {
  return {
    method: init?.method,
    headers: [...new Headers(init?.headers)],
    body: undiciBody(init?.body),
    redirect: init?.redirect,
    signal: init?.signal,
  };
}

function undiciBody(body: RequestInit["body"]): UndiciRequestInit["body"] {
  if (body === undefined || body === null) return body;
  if (typeof body === "string" || body instanceof URLSearchParams || body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return body;
  }
  throw new TypeError(`The pinned dialer carries a string, URLSearchParams or bytes body, not ${body.constructor.name}`);
}

/**
 * The JWKS key cache for the composition's OIDC-class verifier entries
 * (the federated-IdP lane and the direct-login lane): one mechanism for "which public key signed this token", extracted from
 * the federated verifier so the two lanes cannot fork it.
 *
 * One mechanism, one INSTANCE PER TRUST LEVEL: the fetch is a required
 * input because the two lanes dial different kinds of URL. The direct
 * lane's document is the operator's own tenant (configuration, fetched
 * with the platform fetch, and a loopback tenant is a normal development
 * and spike setup); a federated FederationIssuer's `jwks_uri` is written
 * by any organization admin, so its instance is handed the composition's
 * egress-guarded fetch. The cache judges nothing
 * itself: a guard refusal propagates unchanged, and the lane that asked
 * decides what it means. A refusal of the asked URL's own check, before
 * any dial, is never cached: it costs a name lookup, and a provider whose
 * name moves to a public address must work at once. One raised after a
 * dial (on a redirect hop, at the redirect budget, or past the body
 * bound) is a failure like any other, below. The refusal says which it
 * is: a check refusal names the URL it judged, and only the first hop's
 * is the asked one, unless the document redirects to its own URL and
 * that URL's name answers differently on the second check. That edge is
 * read as a first-hop refusal and left uncached: each token then costs
 * one coalesced dial of the admin's own public host, as every refusal
 * did before. Telling it apart would need the guard to say whether it
 * dialled.
 *
 * Shape: a JWKS document is fetched per `jwks_uri`, its RSA signing
 * members indexed by `kid` as node:crypto KeyObjects, and the index reused
 * for JWKS_CACHE_TTL_MS. A member is a signing key when it says nothing
 * against it: a `use` other than `sig`, or an `alg` other than RS256, the
 * one algorithm the lanes verify, keeps a member out, as RFC 7517 §4.2 and
 * §4.4 intend. Rotation is handled the way Nimbus and jose handle it: a
 * `kid` the cached index does not carry triggers ONE refetch (the new key
 * is live before the old one leaves the document), rate-limited to
 * JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS per document so a flood of forged
 * tokens with random kids cannot turn the cache into a request amplifier
 * against the issuer. A document whose fetch failed after dialing (a
 * network fault, a timeout, an error status, a body that is no key set)
 * is remembered for the same interval and its failure answered again
 * without a dial: while an
 * issuer's document is down, or an admin points a provider at an address
 * that hangs, each token costs one lookup, not one guarded dial of up to
 * JWKS_FETCH_TIMEOUT_MS. Concurrent callers share one dial per document,
 * its key set or its failure, so a burst of tokens at a lapsed TTL or a
 * rotation costs one dial, not one per token. A member that is no usable
 * RSA key is skipped, never fatal to its neighbours, and a document's
 * skipped members are one bounded warn line per dial.
 *
 * Fault doctrine (the chassis contract, in
 * `@stigmer/server`'s `extensions/identity.ts`): a document that cannot be
 * fetched or parsed is INFRASTRUCTURE — thrown as a plain Error so the
 * verifier chain maps it to INTERNAL, never as a credential rejection.
 * An unknown kid after the refetch is the CALLER's problem —
 * `keyFor` answers undefined and the verifier throws its own
 * Unauthenticated copy.
 */
import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";

import { EgressError } from "@stigmer/outbound/egress";
import type { Logger } from "@stigmer/server";

/** How long a fetched key set is trusted before it is fetched again. */
export const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
export const JWKS_FETCH_TIMEOUT_MS = 10_000;
/** One rotation refetch per document per interval — the Nimbus default outage-tolerant rate. */
export const JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS = 30 * 1000;
/**
 * How many skipped members' kids a document's warn line names, and how
 * much of each: the document is an organization admin's, so its line is
 * bounded whatever the document holds.
 */
const SKIPPED_KID_SAMPLE = 5;
const SKIPPED_KID_MAX_LENGTH = 64;

export interface JwksKeyCache {
  /**
   * The public key `kid` names in the document at `jwksUri`, refetching
   * on TTL expiry and (rate-limited) on an unknown kid. Undefined when the
   * document — fresh — does not carry the kid.
   */
  keyFor(jwksUri: string, kid: string): Promise<KeyObject | undefined>;
}

export interface JwksKeyCacheDeps {
  /** The fetch this instance's documents are dialed with; its trust is the caller's statement. */
  readonly fetchImpl: typeof fetch;
  /** Where a skipped member is reported: a provider's damaged key file is never silent. */
  readonly logger: Logger;
  readonly nowMs?: () => number;
}

interface CachedJwks {
  readonly keysByKid: Map<string, KeyObject>;
  readonly fetchedAtMs: number;
}

interface FailedJwks {
  readonly error: unknown;
  readonly failedAtMs: number;
}

/**
 * Whether an error is the guard refusing the asked URL's own check, before
 * any dial. Every refusal kind has an arm and the switch is `never`-closed,
 * so a kind the guard adds fails this file's typecheck at the pin advance
 * instead of being guessed.
 */
function refusedBeforeDialing(error: unknown, jwksUri: string): boolean {
  if (!(error instanceof EgressError)) {
    return false;
  }
  const refusal = error.refusal;
  switch (refusal.kind) {
    case "invalid-url":
      // A check refusal too, though the guard parses its input before it
      // checks it, so today a URL that does not parse arrives as a TypeError.
      return refusal.url === jwksUri;
    case "unsupported-scheme":
    case "unresolvable":
    case "blocked":
      return refusal.url.href === URL.parse(jwksUri)?.href;
    case "too-many-redirects":
    case "response-too-large":
      return false;
    /* v8 ignore start -- @preserve: unreachable while every refusal kind has an arm above; the assignment fails the typecheck the day the guard adds one */
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
    /* v8 ignore stop */
  }
}

export function newJwksKeyCache(deps: JwksKeyCacheDeps): JwksKeyCache {
  const { fetchImpl, logger } = deps;
  const nowMs = deps.nowMs ?? Date.now;
  const cache = new Map<string, CachedJwks>();
  const failures = new Map<string, FailedJwks>();
  const inflight = new Map<string, Promise<CachedJwks>>();

  /**
   * The document, or the failure a recent fetch of it met, answered again
   * without a dial; a dial already under way is shared, not repeated.
   */
  async function fetchDocument(jwksUri: string): Promise<CachedJwks> {
    const failed = failures.get(jwksUri);
    if (failed !== undefined && nowMs() - failed.failedAtMs < JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS) {
      throw failed.error;
    }
    const pending = inflight.get(jwksUri);
    if (pending !== undefined) {
      return pending;
    }
    const dial = dialAndRemember(jwksUri).finally(() => {
      inflight.delete(jwksUri);
    });
    inflight.set(jwksUri, dial);
    return dial;
  }

  /** One dial, its failure written to the map before any waiter sees it. */
  async function dialAndRemember(jwksUri: string): Promise<CachedJwks> {
    try {
      const fetched = await dialDocument(jwksUri);
      failures.delete(jwksUri);
      return fetched;
    } catch (error) {
      if (!refusedBeforeDialing(error, jwksUri)) {
        failures.set(jwksUri, { error, failedAtMs: nowMs() });
      }
      throw error;
    }
  }

  async function dialDocument(jwksUri: string): Promise<CachedJwks> {
    const response = await fetchImpl(jwksUri, {
      signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`JWKS fetch answered ${response.status}: ${jwksUri}`);
    }
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) {
      throw new Error(`JWKS document has no keys array: ${jwksUri}`);
    }
    const keysByKid = new Map<string, KeyObject>();
    const skippedKids: string[] = [];
    for (const jwk of body.keys) {
      if (jwk === null || typeof jwk !== "object") {
        continue;
      }
      const candidate = jwk as { kid?: unknown; kty?: unknown; use?: unknown; alg?: unknown };
      if (typeof candidate.kid !== "string" || candidate.kty !== "RSA") {
        continue;
      }
      if (candidate.use !== undefined && candidate.use !== "sig") {
        continue;
      }
      if (candidate.alg !== undefined && candidate.alg !== "RS256") {
        continue;
      }
      let key: KeyObject;
      try {
        key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
      } catch {
        skippedKids.push(candidate.kid);
        continue;
      }
      keysByKid.set(candidate.kid, key);
    }
    if (skippedKids.length > 0) {
      logger.warn("JWKS members skipped: not usable RSA keys", {
        jwksUri,
        skipped: skippedKids.length,
        kids: skippedKids.slice(0, SKIPPED_KID_SAMPLE).map((kid) => kid.slice(0, SKIPPED_KID_MAX_LENGTH)),
      });
    }
    const fetched = { keysByKid, fetchedAtMs: nowMs() };
    cache.set(jwksUri, fetched);
    return fetched;
  }

  return {
    async keyFor(jwksUri, kid): Promise<KeyObject | undefined> {
      let cached = cache.get(jwksUri);
      if (
        cached === undefined ||
        nowMs() - cached.fetchedAtMs >= JWKS_CACHE_TTL_MS
      ) {
        cached = await fetchDocument(jwksUri);
      }
      const key = cached.keysByKid.get(kid);
      if (key !== undefined) {
        return key;
      }
      // Rotation arm: a fresh document may carry the kid the cached one
      // predates; refetch once per interval, never per miss.
      if (
        nowMs() - cached.fetchedAtMs <
        JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS
      ) {
        return undefined;
      }
      const refreshed = await fetchDocument(jwksUri);
      return refreshed.keysByKid.get(kid);
    },
  };
}

/**
 * Pins the shared JWKS key cache: kid-keyed RSA
 * indexing, the TTL reuse, the rotation refetch on an unknown kid and its
 * rate limit, the plain-error fault doctrine for unreachable or
 * malformed documents (infrastructure, never a credential rejection), and
 * the trust split: over an egress-guarded fetch a
 * refusal passes through as the typed EgressError, and one refused before
 * any dial (the first hop's check) is never cached. A document that failed
 * after dialing, a refusal on a redirect hop or of an oversized body
 * included, is answered again without a dial for the rotation interval,
 * then dialed again. Concurrent callers share one dial per document, its
 * key set or its failure. A member whose `use` or `alg` says it is no RS256
 * signing key is never indexed, and one that is no usable RSA key is
 * skipped while its neighbours serve, in one log line per document.
 */
import { generateKeyPairSync } from "node:crypto";
import {
  asFetch,
  EgressError,
  type EgressRefusal,
  guardedFetch,
} from "@stigmer/outbound/egress";
import { type Logger, strictEgressPolicy } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { SILENT_LOGGER } from "../../__test-utils__/refusing-doubles.js";
import {
  JWKS_CACHE_TTL_MS,
  JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS,
  newJwksKeyCache,
} from "../jwks.js";

const JWKS_URI = "https://idp.test/.well-known/jwks.json";

function rsaJwk(kid: string): Record<string, unknown> {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    ...publicKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
}

/** A fetch whose served document can be swapped between calls, counting fetches. */
function servedJwks(initial: Record<string, unknown>[]): {
  fetchImpl: typeof fetch;
  serve(keys: Record<string, unknown>[]): void;
  fetches(): number;
} {
  let keys = initial;
  let count = 0;
  return {
    fetchImpl: (() => {
      count += 1;
      return Promise.resolve(new Response(JSON.stringify({ keys })));
    }) as typeof fetch,
    serve(next) {
      keys = next;
    },
    fetches: () => count,
  };
}

function clock(startMs = 1_700_000_000_000): {
  nowMs: () => number;
  advance(ms: number): void;
} {
  let now = startMs;
  return { nowMs: () => now, advance: (ms) => (now += ms) };
}

interface LoggedLine {
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

/** A logger that keeps its warn lines, for the tests whose line is the assertion. */
function warnRecorder(): { logger: Logger; warnings: LoggedLine[] } {
  const warnings: LoggedLine[] = [];
  return {
    logger: {
      ...SILENT_LOGGER,
      warn: (message, fields) => {
        warnings.push({ message, fields });
      },
    },
    warnings,
  };
}

/**
 * A fetch that answers every dial with `answer`, counting dials, and
 * resolves each name in `addresses` (any other name to a public address),
 * wrapped in the real egress guard: what the federated lane dials through.
 */
function guardedDials(
  answer: (url: URL) => Response,
  options: { addresses?: Record<string, string>; maxResponseBytes?: number } = {},
): { fetchImpl: typeof fetch; dials(): number } {
  let count = 0;
  const guarded = guardedFetch(strictEgressPolicy(), {
    fetchImpl: (url) => {
      count += 1;
      return Promise.resolve(answer(new URL(url)));
    },
    lookup: (hostname) =>
      Promise.resolve([options.addresses?.[hostname] ?? "104.16.0.1"]),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
  });
  return { fetchImpl: asFetch(guarded), dials: () => count };
}

/** A fetch that answers its first dial by throwing `refusal` as the guard would, then serves `keys`. */
function refusingOnce(
  refusal: EgressRefusal,
  keys: Record<string, unknown>[],
): { fetchImpl: typeof fetch; dials(): number } {
  let count = 0;
  return {
    fetchImpl: (() => {
      count += 1;
      return count === 1
        ? Promise.reject(new EgressError(refusal))
        : Promise.resolve(new Response(JSON.stringify({ keys })));
    }) as typeof fetch,
    dials: () => count,
  };
}

describe("newJwksKeyCache", () => {
  it("indexes RSA members by kid and skips non-RSA or kid-less entries", async () => {
    const served = servedJwks([
      rsaJwk("k1"),
      { kty: "EC", kid: "ec-1", crv: "P-256", x: "AA", y: "AA" },
      { ...rsaJwk("dropped"), kid: undefined },
    ]);
    const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: SILENT_LOGGER });

    expect(await cache.keyFor(JWKS_URI, "k1")).toBeDefined();
    expect(await cache.keyFor(JWKS_URI, "ec-1")).toBeUndefined();
    expect(await cache.keyFor(JWKS_URI, "dropped")).toBeUndefined();
  });

  it("serves from the cache inside the TTL and refetches once it lapses", async () => {
    const served = servedJwks([rsaJwk("k1")]);
    const time = clock();
    const cache = newJwksKeyCache({
      fetchImpl: served.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    await cache.keyFor(JWKS_URI, "k1");
    await cache.keyFor(JWKS_URI, "k1");
    expect(served.fetches()).toBe(1);

    time.advance(JWKS_CACHE_TTL_MS);
    await cache.keyFor(JWKS_URI, "k1");
    expect(served.fetches()).toBe(2);
  });

  it("refetches ONCE on an unknown kid after the rate-limit interval (rotation)", async () => {
    const served = servedJwks([rsaJwk("k1")]);
    const time = clock();
    const cache = newJwksKeyCache({
      fetchImpl: served.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    await cache.keyFor(JWKS_URI, "k1");
    // A rotation lands: the issuer now serves k2 beside k1.
    served.serve([rsaJwk("k1"), rsaJwk("k2")]);

    // Inside the interval the miss is answered from the cached index — no
    // refetch (a forged-kid flood cannot amplify against the issuer).
    expect(await cache.keyFor(JWKS_URI, "k2")).toBeUndefined();
    expect(served.fetches()).toBe(1);

    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);
    expect(await cache.keyFor(JWKS_URI, "k2")).toBeDefined();
    expect(served.fetches()).toBe(2);

    // A kid the fresh document does not carry stays undefined.
    expect(await cache.keyFor(JWKS_URI, "never")).toBeUndefined();
  });

  it("caches per document, not globally", async () => {
    const a = servedJwks([rsaJwk("a1")]);
    const cache = newJwksKeyCache({
      fetchImpl: ((input: string | URL | Request) =>
        new URL(String(input)).host === "a.test"
          ? a.fetchImpl(input)
          : Promise.resolve(
              new Response(JSON.stringify({ keys: [rsaJwk("b1")] })),
            )) as typeof fetch,
      logger: SILENT_LOGGER,
    });
    expect(await cache.keyFor("https://a.test/jwks", "a1")).toBeDefined();
    expect(await cache.keyFor("https://b.test/jwks", "b1")).toBeDefined();
    expect(await cache.keyFor("https://b.test/jwks", "a1")).toBeUndefined();
  });

  it("throws a PLAIN error on an unreachable or malformed document (infrastructure fault)", async () => {
    const outage = newJwksKeyCache({
      fetchImpl: () => Promise.reject(new Error("connect ETIMEDOUT")),
      logger: SILENT_LOGGER,
    });
    await expect(outage.keyFor(JWKS_URI, "k1")).rejects.toThrow(
      "connect ETIMEDOUT",
    );

    const denied = newJwksKeyCache({
      fetchImpl: () => Promise.resolve(new Response("nope", { status: 503 })),
      logger: SILENT_LOGGER,
    });
    await expect(denied.keyFor(JWKS_URI, "k1")).rejects.toThrow(
      "JWKS fetch answered 503",
    );

    const malformed = newJwksKeyCache({
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ nope: true }))),
      logger: SILENT_LOGGER,
    });
    await expect(malformed.keyFor(JWKS_URI, "k1")).rejects.toThrow(
      "no keys array",
    );
  });

  it("passes an egress refusal through as the typed error and never caches it", async () => {
    const served = servedJwks([rsaJwk("k1")]);
    let resolvesTo = "10.0.0.5";
    const cache = newJwksKeyCache({
      fetchImpl: asFetch(
        guardedFetch(strictEgressPolicy(), {
          fetchImpl: served.fetchImpl,
          lookup: () => Promise.resolve([resolvesTo]),
        }),
      ),
      logger: SILENT_LOGGER,
    });

    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBeInstanceOf(EgressError);
    expect(served.fetches()).toBe(0);

    // The lane decides what a refusal means; the cache only must not
    // remember it, so a provider whose name moves to a public address works.
    resolvesTo = "104.16.0.1";
    expect(await cache.keyFor(JWKS_URI, "k1")).toBeDefined();
    expect(served.fetches()).toBe(1);
  });

  it("answers a document that failed after dialing again without a dial, until the interval passes", async () => {
    const time = clock();
    let fetches = 0;
    let status = 503;
    const cache = newJwksKeyCache({
      fetchImpl: (() => {
        fetches += 1;
        return Promise.resolve(
          status === 200
            ? new Response(JSON.stringify({ keys: [rsaJwk("k1")] }))
            : new Response("down", { status }),
        );
      }) as typeof fetch,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toThrow("JWKS fetch answered 503");
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toThrow("JWKS fetch answered 503");
    expect(fetches).toBe(1);

    status = 200;
    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);
    expect(await cache.keyFor(JWKS_URI, "k1")).toBeDefined();
    expect(fetches).toBe(2);
  });

  it("never indexes a member whose use or alg says it is no RS256 signing key", async () => {
    const served = servedJwks([
      rsaJwk("signing"),
      { ...rsaJwk("encryption"), use: "enc" },
      { ...rsaJwk("rsa-pss"), alg: "PS256" },
      { ...rsaJwk("unlabelled"), use: undefined, alg: undefined },
    ]);
    const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: SILENT_LOGGER });

    expect(await cache.keyFor(JWKS_URI, "signing")).toBeDefined();
    expect(await cache.keyFor(JWKS_URI, "unlabelled")).toBeDefined();
    expect(await cache.keyFor(JWKS_URI, "encryption")).toBeUndefined();
    expect(await cache.keyFor(JWKS_URI, "rsa-pss")).toBeUndefined();
  });

  it("remembers a body the guard refused as too large, and dials again after the interval", async () => {
    const time = clock();
    const dials = guardedDials(
      () => new Response(JSON.stringify({ keys: [rsaJwk("k1")] })),
      { maxResponseBytes: 64 },
    );
    const cache = newJwksKeyCache({
      fetchImpl: dials.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    const first = await cache.keyFor(JWKS_URI, "k1").catch((error: unknown) => error);
    expect(first).toBeInstanceOf(EgressError);
    expect((first as EgressError).refusal.kind).toBe("response-too-large");
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBe(first);
    expect(dials.dials()).toBe(1);

    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBeInstanceOf(EgressError);
    expect(dials.dials()).toBe(2);
  });

  it("remembers a redirect chain the guard stopped as too long", async () => {
    const time = clock();
    const dials = guardedDials(
      (url) =>
        new Response(null, {
          status: 302,
          headers: { location: `${url.pathname}x` },
        }),
    );
    const cache = newJwksKeyCache({
      fetchImpl: dials.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    const first = await cache.keyFor(JWKS_URI, "k1").catch((error: unknown) => error);
    expect((first as EgressError).refusal.kind).toBe("too-many-redirects");
    const dialsForOneChain = dials.dials();
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBe(first);
    expect(dials.dials()).toBe(dialsForOneChain);

    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBeInstanceOf(EgressError);
    expect(dials.dials()).toBe(dialsForOneChain * 2);
  });

  it("remembers a redirect to a refused address, since the first hop was dialed", async () => {
    const time = clock();
    const dials = guardedDials(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://internal.test/jwks" },
        }),
      { addresses: { "internal.test": "10.0.0.5" } },
    );
    const cache = newJwksKeyCache({
      fetchImpl: dials.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });

    const first = await cache.keyFor(JWKS_URI, "k1").catch((error: unknown) => error);
    expect((first as EgressError).refusal.kind).toBe("blocked");
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBe(first);
    expect(dials.dials()).toBe(1);

    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);
    await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBeInstanceOf(EgressError);
    expect(dials.dials()).toBe(2);
  });

  it("answers a refusal by its kind and url: before the dial uncached, after it remembered", async () => {
    const asked = new URL(JWKS_URI);
    const elsewhere = new URL("https://other.test/jwks");
    const cases: { refusal: EgressRefusal; remembered: boolean }[] = [
      { refusal: { kind: "invalid-url", url: JWKS_URI }, remembered: false },
      { refusal: { kind: "invalid-url", url: "not a url" }, remembered: true },
      {
        refusal: { kind: "unsupported-scheme", url: asked, scheme: "ftp:" },
        remembered: false,
      },
      {
        refusal: { kind: "unsupported-scheme", url: elsewhere, scheme: "ftp:" },
        remembered: true,
      },
      {
        refusal: { kind: "unresolvable", url: asked, hostname: asked.hostname, policy: "strict" },
        remembered: false,
      },
      {
        refusal: { kind: "unresolvable", url: elsewhere, hostname: elsewhere.hostname, policy: "strict" },
        remembered: true,
      },
      {
        refusal: {
          kind: "blocked",
          url: asked,
          hostname: asked.hostname,
          address: "10.0.0.5",
          reason: "private",
          policy: "strict",
        },
        remembered: false,
      },
      {
        refusal: {
          kind: "blocked",
          url: elsewhere,
          hostname: elsewhere.hostname,
          address: "10.0.0.5",
          reason: "private",
          policy: "strict",
        },
        remembered: true,
      },
      { refusal: { kind: "too-many-redirects", url: asked, hops: 3 }, remembered: true },
      { refusal: { kind: "response-too-large", url: asked, maxBytes: 64 }, remembered: true },
    ];

    for (const { refusal, remembered } of cases) {
      const served = refusingOnce(refusal, [rsaJwk("k1")]);
      const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: SILENT_LOGGER });

      await expect(cache.keyFor(JWKS_URI, "k1")).rejects.toBeInstanceOf(EgressError);
      const second = cache.keyFor(JWKS_URI, "k1");
      if (remembered) {
        await expect(second, refusal.kind).rejects.toBeInstanceOf(EgressError);
        expect(served.dials(), refusal.kind).toBe(1);
      } else {
        expect(await second, refusal.kind).toBeDefined();
        expect(served.dials(), refusal.kind).toBe(2);
      }
    }
  });

  it("shares one dial among concurrent cold callers", async () => {
    const served = servedJwks([rsaJwk("k1")]);
    const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: SILENT_LOGGER });

    const keys = await Promise.all(
      Array.from({ length: 20 }, () => cache.keyFor(JWKS_URI, "k1")),
    );

    expect(keys.every((key) => key !== undefined)).toBe(true);
    expect(served.fetches()).toBe(1);
  });

  it("shares one rotation refetch among concurrent unknown-kid misses", async () => {
    const served = servedJwks([rsaJwk("k1")]);
    const time = clock();
    const cache = newJwksKeyCache({
      fetchImpl: served.fetchImpl,
      logger: SILENT_LOGGER,
      nowMs: time.nowMs,
    });
    await cache.keyFor(JWKS_URI, "k1");
    served.serve([rsaJwk("k1"), rsaJwk("k2")]);
    time.advance(JWKS_KID_MISS_REFETCH_MIN_INTERVAL_MS);

    const keys = await Promise.all(
      Array.from({ length: 20 }, () => cache.keyFor(JWKS_URI, "k2")),
    );

    expect(keys.every((key) => key !== undefined)).toBe(true);
    expect(served.fetches()).toBe(2);
  });

  it("rejects every concurrent waiter on one failed dial with that dial's error", async () => {
    let dials = 0;
    const outage = new Error("connect ECONNREFUSED");
    const cache = newJwksKeyCache({
      fetchImpl: (() => {
        dials += 1;
        return Promise.reject(outage);
      }) as typeof fetch,
      logger: SILENT_LOGGER,
    });

    const answers = await Promise.allSettled(
      Array.from({ length: 20 }, () => cache.keyFor(JWKS_URI, "k1")),
    );

    expect(answers.every((answer) => answer.status === "rejected" && answer.reason === outage)).toBe(true);
    expect(dials).toBe(1);
  });

  it("skips and logs a member that is no usable RSA key, and serves its neighbours", async () => {
    const recorder = warnRecorder();
    const served = servedJwks([
      rsaJwk("k1"),
      { kty: "RSA", kid: "broken", alg: "RS256", use: "sig" },
      rsaJwk("k2"),
    ]);
    const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: recorder.logger });

    expect(await cache.keyFor(JWKS_URI, "k1")).toBeDefined();
    expect(await cache.keyFor(JWKS_URI, "k2")).toBeDefined();
    expect(await cache.keyFor(JWKS_URI, "broken")).toBeUndefined();
    expect(recorder.warnings).toEqual([
      {
        message: "JWKS members skipped: not usable RSA keys",
        fields: { jwksUri: JWKS_URI, skipped: 1, kids: ["broken"] },
      },
    ]);
  });

  it("logs one line per document however many members it skips, naming a bounded sample of kids", async () => {
    const recorder = warnRecorder();
    const longKid = "k".repeat(500);
    const served = servedJwks([
      { kty: "RSA", kid: longKid },
      ...Array.from({ length: 999 }, (_, index) => ({ kty: "RSA", kid: `broken-${index}` })),
      rsaJwk("k1"),
    ]);
    const cache = newJwksKeyCache({ fetchImpl: served.fetchImpl, logger: recorder.logger });

    expect(await cache.keyFor(JWKS_URI, "k1")).toBeDefined();
    expect(recorder.warnings).toEqual([
      {
        message: "JWKS members skipped: not usable RSA keys",
        fields: {
          jwksUri: JWKS_URI,
          skipped: 1000,
          kids: ["k".repeat(64), "broken-0", "broken-1", "broken-2", "broken-3"],
        },
      },
    ]);
  });
});

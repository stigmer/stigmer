/**
 * Pins the egress check: scheme first, then every resolved address, literal
 * hosts without a lookup, an unresolvable name refused, and the caller's
 * signal bounding a resolver that never answers. Pins the sentences too:
 * under strict a name that does not resolve and one that resolves to a
 * refused address read alike and name no address, while relaxed keeps the
 * detail its operator's own network warrants.
 */
import { describe, expect, it } from "vitest";

import { egressPolicyForPosture } from "../egress/address.js";
import { checkEgress, describeRefusal, EgressError, refusalWithholdsResolution, type LookupFn } from "../egress/check.js";

const strict = egressPolicyForPosture("strict");
const relaxed = egressPolicyForPosture("relaxed");

function table(entries: Record<string, readonly string[]>): LookupFn {
  return async (hostname) => {
    const found = entries[hostname];
    if (found === undefined) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };
}

describe("checkEgress", () => {
  it("refuses a malformed URL before resolving anything", async () => {
    const result = await checkEgress("not a url", strict, { lookup: table({}) });
    expect(result).toEqual({ ok: false, refusal: { kind: "invalid-url", url: "not a url" } });
  });

  it.each(["file:///etc/passwd", "ftp://vendor.test/x", "gopher://vendor.test"])("refuses the scheme of %s", async (url) => {
    const result = await checkEgress(url, strict, { lookup: table({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe("unsupported-scheme");
  });

  it("judges a literal IP host without a lookup", async () => {
    let lookups = 0;
    const lookup: LookupFn = async () => {
      lookups += 1;
      return [];
    };
    const refused = await checkEgress("http://127.0.0.1:8080/x", strict, { lookup });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal).toMatchObject({ kind: "blocked", address: "127.0.0.1", reason: "loopback", policy: "strict" });
    const allowed = await checkEgress("http://127.0.0.1:3000/mcp", relaxed, { lookup });
    expect(allowed).toMatchObject({ ok: true, addresses: ["127.0.0.1"] });
    const bracketed = await checkEgress("http://[::1]/", strict, { lookup });
    expect(bracketed.ok).toBe(false);
    expect(lookups).toBe(0);
  });

  it("refuses a name when ANY of its addresses is blocked", async () => {
    const lookup = table({ "split.vendor.test": ["104.16.0.1", "10.0.0.7"] });
    const result = await checkEgress("https://split.vendor.test/mcp", strict, { lookup });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toMatchObject({ kind: "blocked", hostname: "split.vendor.test", address: "10.0.0.7" });
  });

  it("allows a name whose every address the policy allows, and reports them", async () => {
    const lookup = table({ "mcp.vendor.test": ["104.16.0.1", "2606:4700::6810:1"] });
    const result = await checkEgress("https://mcp.vendor.test/mcp", strict, { lookup });
    expect(result).toMatchObject({ ok: true, addresses: ["104.16.0.1", "2606:4700::6810:1"] });
  });

  it("refuses an unresolvable name", async () => {
    const result = await checkEgress("https://nowhere.vendor.test/", strict, { lookup: table({}) });
    expect(result).toMatchObject({ ok: false, refusal: { kind: "unresolvable", hostname: "nowhere.vendor.test", policy: "strict" } });
  });

  it("refuses a name that resolves to nothing", async () => {
    const result = await checkEgress("https://empty.vendor.test/", strict, { lookup: table({ "empty.vendor.test": [] }) });
    expect(result).toMatchObject({ ok: false, refusal: { kind: "unresolvable" } });
  });

  it("gives up on a resolver that never answers when the signal aborts", async () => {
    const hanging: LookupFn = () => new Promise(() => undefined);
    const controller = new AbortController();
    const pending = checkEgress("https://slow.vendor.test/", strict, { lookup: hanging, signal: controller.signal });
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });

  it("rejects at once on an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(checkEgress("https://slow.vendor.test/", strict, { lookup: table({}), signal: controller.signal })).rejects.toThrow("gone");
  });
});

describe("describeRefusal and EgressError", () => {
  it("renders one sentence per refusal and the error carries the refusal", () => {
    const url = new URL("https://split.vendor.test/mcp");
    const error = new EgressError({ kind: "blocked", url, hostname: url.hostname, address: "10.0.0.7", reason: "private (RFC 1918)", policy: "strict" });
    expect(error.name).toBe("EgressError");
    expect(error.message).toBe("Refusing to reach split.vendor.test: it does not resolve to a public address.");
    expect(error.refusal).toMatchObject({ kind: "blocked", address: "10.0.0.7", reason: "private (RFC 1918)" });
    expect(describeRefusal({ kind: "unsupported-scheme", url: new URL("ftp://x.test/"), scheme: "ftp" })).toBe('Unsupported URL scheme "ftp": only http and https are allowed.');
    expect(describeRefusal({ kind: "too-many-redirects", url, hops: 3 })).toBe("Refusing to follow more than 3 redirects from https://split.vendor.test/mcp.");
  });

  it("under strict, a name that does not resolve and one that resolves to a refused address read as one sentence naming no address", async () => {
    const lookup = table({ "redis.internal": ["10.4.2.7"] });
    const refusals = await Promise.all(
      ["https://redis.internal/", "https://nowhere.internal/"].map(async (url) => {
        const result = await checkEgress(url, strict, { lookup });
        if (result.ok) throw new Error(`expected ${url} to be refused`);
        return result.refusal;
      }),
    );
    expect(refusals.map((refusal) => refusal.kind)).toEqual(["blocked", "unresolvable"]);
    const [blocked, unresolvable] = refusals.map(describeRefusal);
    expect(blocked).toBe("Refusing to reach redis.internal: it does not resolve to a public address.");
    expect(unresolvable).toBe("Refusing to reach nowhere.internal: it does not resolve to a public address.");
    expect(blocked).not.toContain("10.4.2.7");
    expect(refusals.every(refusalWithholdsResolution)).toBe(true);
  });

  it("under strict, a literal IP host keeps its range, since nothing was resolved and the address is the caller's own", async () => {
    const result = await checkEgress("http://127.0.0.1:8080/", strict, { lookup: table({}) });
    if (result.ok) throw new Error("expected the literal to be refused");
    expect(refusalWithholdsResolution(result.refusal)).toBe(false);
    expect(describeRefusal(result.refusal)).toBe(
      "Refusing to reach 127.0.0.1: it resolves to 127.0.0.1, a loopback address the strict egress policy does not dial.",
    );
  });

  it("under relaxed, the sentences keep the address and tell an unresolvable name apart", async () => {
    const lookup = table({ "metadata.internal": ["169.254.169.254"] });
    const blocked = await checkEgress("http://metadata.internal/", relaxed, { lookup });
    const unresolvable = await checkEgress("http://nowhere.internal/", relaxed, { lookup });
    if (blocked.ok || unresolvable.ok) throw new Error("expected both to be refused");
    expect(describeRefusal(blocked.refusal)).toBe(
      "Refusing to reach metadata.internal: it resolves to 169.254.169.254, a link-local (cloud metadata) address the relaxed egress policy does not dial.",
    );
    expect(describeRefusal(unresolvable.refusal)).toBe("Could not resolve hostname: nowhere.internal");
  });
});

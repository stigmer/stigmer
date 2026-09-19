/**
 * Pins the egress check: scheme first, then every resolved address, literal
 * hosts without a lookup, an unresolvable name refused, and the caller's
 * signal bounding a resolver that never answers.
 */
import { describe, expect, it } from "vitest";

import { egressPolicyForPosture } from "../egress/address.js";
import { checkEgress, describeRefusal, EgressError, type LookupFn } from "../egress/check.js";

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
    expect(result).toMatchObject({ ok: false, refusal: { kind: "unresolvable", hostname: "nowhere.vendor.test" } });
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
    expect(error.message).toBe("Refusing to reach split.vendor.test: it resolves to 10.0.0.7, a private (RFC 1918) address the strict egress policy does not dial.");
    expect(error.refusal.kind).toBe("blocked");
    expect(describeRefusal({ kind: "unsupported-scheme", url: new URL("ftp://x.test/"), scheme: "ftp" })).toBe('Unsupported URL scheme "ftp": only http and https are allowed.');
    expect(describeRefusal({ kind: "too-many-redirects", url, hops: 3 })).toBe("Refusing to follow more than 3 redirects from https://split.vendor.test/mcp.");
  });
});

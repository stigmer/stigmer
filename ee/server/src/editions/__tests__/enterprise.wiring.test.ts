/**
 * Two facts about the self-hosted Enterprise server's composition
 * (editions/enterprise.ts) that no behaviour test can see, pinned where it
 * states them:
 *
 *   - Every URL an organization admin writes is dialed through ONE guarded
 *     fetch, built with `nodeGuardedFetch`, whose connect judges the address
 *     again. The types force the identity unit to receive an
 *     `OutboundFetch`, but the global `fetch` is assignable to it, and so is
 *     a guard built over the platform `fetch` (`guardedFetch` with a
 *     `fetchImpl`), whose platform resolves the name again when it connects,
 *     so the address the guard judged is not the one the socket opens.
 *     Either would compile and quietly reopen the request-forgery path.
 *     The composition's test seam (`options.fetchImpl`) is the only way to
 *     replace the dialer. enterprise-host-wiring.postgres.test.ts proves
 *     the behaviour (a loopback provider refused without dialing, dialed
 *     through the guarded fetch on the operator's word); this suite pins
 *     that there is exactly one such fetch and what it is built from.
 *   - The composition builds exactly one Postgres pool, named `enterprise`,
 *     through postgres/pool.ts, so a second pool arrives as a reviewed new
 *     line here, whatever it is named or wherever its name comes from. A bare
 *     `new pg.Pool(...)` boots and serves, and exits the process the first
 *     time the database drops an idle connection, because nothing listens
 *     for the pool's `'error'`.
 *
 * Read by line shape, as the server's own wiring suites read their
 * sources, refusing to pass on an empty parse.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const COMPOSITION = resolve(dirname(fileURLToPath(import.meta.url)), "..", "enterprise.ts");

function compositionSource(): string {
  const text = readFileSync(COMPOSITION, "utf8");
  expect(text.length, "editions/enterprise.ts read").toBeGreaterThan(0);
  return text;
}

describe("the self-hosted Enterprise server's wiring", () => {
  it("builds its one guarded fetch over the pinned dialer, with only its test seam to replace it", () => {
    const enterprise = compositionSource();
    expect(enterprise.match(/\bnodeGuardedFetch\(/g) ?? [], "nodeGuardedFetch calls").toHaveLength(1);
    expect(enterprise.match(/\bguardedFetch\(/g) ?? [], "guardedFetch calls over another fetch").toHaveLength(0);
    expect(enterprise).toMatch(
      /const outboundFetch = nodeGuardedFetch\(egressPolicy, \{ fetchImpl: options\.fetchImpl \}\);/,
    );
  });

  it("builds exactly one named pool, enterprise, and no bare one", () => {
    const enterprise = compositionSource();
    expect(enterprise.match(/\bnewCompositionPool\(/g) ?? [], "newCompositionPool calls").toHaveLength(1);
    const names = [...enterprise.matchAll(/newCompositionPool\(\{[^}]*?\bname:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual(["enterprise"]);
    expect(enterprise).not.toMatch(/\bnew\s+(?:pg\.)?Pool\s*\(/);
  });
});

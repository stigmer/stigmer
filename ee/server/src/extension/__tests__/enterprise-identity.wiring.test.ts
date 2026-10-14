/**
 * Two facts about the identity unit's shape that every host relies on,
 * pinned where the unit states them:
 *
 *   - The unit takes none of the composition's instances as a port: the
 *     Authorizer, the authorization queries, the list read scope, the
 *     lifecycle, the in-process transport and the policy store arrive on
 *     the library's hand-over (`onComposed`), so no host can hand the unit
 *     a second binding that answers by another rule than the Authorize
 *     step.
 *   - The unit's start makes its schema current, then runs the
 *     organization-link repair, then its owner-row reconcile: the repair
 *     reads policy rows a host's own start may converge first, and the
 *     reconcile reads the links the repair restores.
 *
 * A reintroduced port or a swapped order compiles, boots and serves, and
 * the behaviour suites beside this one (enterprise-identity.test.ts) see
 * the hand-over and the schema run first but not the port list or the
 * repairs' order. So this suite reads the unit's source by shape, as the
 * server's own wiring suites read theirs, refusing to pass on an empty
 * parse.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const UNIT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "enterprise-identity.ts");

function unitSource(): string {
  const text = readFileSync(UNIT, "utf8");
  expect(text.length, "enterprise-identity.ts read").toBeGreaterThan(0);
  return text;
}

/** The text from `opening` to the first `closing` after it, refusing a missing one. */
function block(text: string, opening: string, closing: string): string {
  const start = text.indexOf(opening);
  expect(start, `${opening} present`).toBeGreaterThan(-1);
  const end = text.indexOf(closing, start);
  expect(end, `${opening} closed`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Where each of `calls` first appears in `text`, refusing a missing one. */
function positions(text: string, calls: ReadonlyArray<string>): number[] {
  return calls.map((call) => {
    const at = text.indexOf(call);
    expect(at, `${call} present`).toBeGreaterThan(-1);
    return at;
  });
}

describe("the identity unit's wiring", () => {
  it("takes none of the composition's instances as a port, and takes them on the hand-over", () => {
    const unit = unitSource();
    const ports = block(unit, "export interface EnterpriseIdentityPorts {", "\n}\n");
    const members = new Set([...ports.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:/gm)].map((m) => m[1]));
    expect(members.size, "EnterpriseIdentityPorts members parsed").toBeGreaterThan(5);

    // What the composition hands over: every `services.<name>` the hand-over
    // reads and every key it keeps, read from the block itself so a new
    // instance taken there joins this rule without an edit here; and the
    // forms an instance would take as a port under its own name.
    const handOver = block(unit, "onComposed(services: ComposedServices): void {", "\n    },\n");
    const composed = new Set([
      ...[...handOver.matchAll(/\bservices\.([A-Za-z_]\w*)/g)].map((m) => m[1]),
      ...[...block(handOver, "handedOver = {", "};").matchAll(/^\s*([A-Za-z_]\w*):/gm)].map((m) => m[1]),
      "transport",
      "transportRef",
      "policies",
      "grantStore",
    ]);
    expect(composed.size, "instances the hand-over takes").toBeGreaterThan(8);
    expect([...composed].filter((name) => members.has(name)), "a composition instance taken as a port").toEqual([]);
    expect(unit).toMatch(/^\s*grants: services\.grants,\s*$/m);
    expect(unit).toMatch(/async start\(\): Promise<void> \{/);
  });

  it("makes its schema current on start, then runs the link repair, then the owner-row reconcile", () => {
    const start = block(unitSource(), "async start(): Promise<void> {", "\n    },\n");
    const at = positions(start, [
      "await ports.schema.ensure();",
      "await repairOrganizationLinks();",
      "await revokeOwnerRows();",
    ]);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

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
    for (const member of [
      "authorizer",
      "authorizationQueries",
      "listReadScope",
      "lifecycle",
      "transportRef",
      "policies",
      "policyStore",
      "iamPolicies",
    ]) {
      expect(ports, `EnterpriseIdentityPorts.${member}`).not.toMatch(new RegExp(`readonly ${member}\\??:`));
    }
    expect(unit).toMatch(/onComposed\(services: ComposedServices\): void \{/);
    expect(unit).toMatch(/^\s*iamPolicies: services\.iamPolicies,\s*$/m);
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

/**
 * Pins the one definition of an access row and the one conversion from a
 * caller to the actor a change record carries (change.ts). An access row
 * names a person or an audience written as a userset; a row naming a
 * resource with no relation is a structural link and is never recorded.
 * The actor keeps the caller's id and class and drops everything else, so
 * a permission history holds no email, display name or token.
 */
import { describe, expect, it } from "vitest";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { grantsAccess, policyActorOf } from "../change.js";
import { triple } from "./support.js";

describe("grantsAccess", () => {
  const agent = { kind: "agent", id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz" };

  it.each([
    ["a person", { kind: "identity_account", id: "ida_1" }, true],
    [
      "a team's members",
      { kind: "team", id: "tm_1", relation: "member" },
      true,
    ],
    [
      "an organization's viewers",
      { kind: "organization", id: "acme", relation: "viewer" },
      true,
    ],
    [
      "an identity provider's platform users",
      { kind: "identity_provider", id: "idp_1", relation: "platform_user" },
      true,
    ],
    ["a parent organization", { kind: "organization", id: "acme" }, false],
    ["a blueprint (default instance)", { kind: "agent", id: "agt_2" }, false],
    [
      "an identity provider (managed organization)",
      { kind: "identity_provider", id: "idp_1" },
      false,
    ],
  ])("a row naming %s: %s", (_name, principal, expected) => {
    expect(grantsAccess(triple(principal, "viewer", agent))).toBe(expected);
  });
});

describe("policyActorOf", () => {
  it("keeps the caller's id and class and nothing else", () => {
    const caller: CallerIdentity = {
      identityId: "ida_1",
      callerClass: "internal",
      issuer: "https://issuer.example.com",
      rawToken: "secret",
      email: "alice@example.com",
      displayName: "Alice",
      origin: "in-process",
    };
    expect(policyActorOf(caller)).toStrictEqual({
      id: "ida_1",
      callerClass: "internal",
    });
  });
});

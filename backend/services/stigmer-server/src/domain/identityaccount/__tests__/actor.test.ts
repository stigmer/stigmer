/**
 * Pins the identity-account domain's one rule for naming a person
 * (actor.ts), which every audit stamp built from a row, getActorInfo and
 * the access listings share (stigmer/stigmer#1226):
 *
 *   - `accountDisplayName`: first + last, then either alone, then the
 *     account's own name, then its email, so the trusted-local operator
 *     reads as the name it configured and a provisioned person as their
 *     provider's name, or their address when the provider gave none;
 *   - `principalOf`: the account id with the row's email and display
 *     name, a credential's claims filling only a field the row leaves
 *     empty, an empty result left out, and a row with no id a loud fault
 *     rather than a `""` principal;
 *   - both constructions built on it (`accountAsCaller`,
 *     `accountAsRunnerCaller`) carry the same principal.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import {
  accountAsCaller,
  accountAsRunnerCaller,
  accountDisplayName,
  principalOf,
} from "../actor.js";

function account(fields: {
  id?: string;
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id: fields.id ?? "ida_ada", name: fields.name ?? "" },
    spec: {
      idpId: "auth0|ada",
      email: fields.email ?? "",
      firstName: fields.firstName ?? "",
      lastName: fields.lastName ?? "",
    },
  });
}

describe("accountDisplayName", () => {
  it.each([
    [
      "first and last",
      { firstName: "Ada", lastName: "Lovelace", name: "ada@example.com" },
      "Ada Lovelace",
    ],
    ["first alone", { firstName: "Ada", name: "ada@example.com" }, "Ada"],
    [
      "last alone",
      { lastName: "Lovelace", name: "ada@example.com" },
      "Lovelace",
    ],
    [
      "the account's own name (the laptop operator's configured name)",
      { name: "The Operator", email: "op@example.com" },
      "The Operator",
    ],
    [
      "the email, when nothing else names the account",
      { email: "ada@example.com" },
      "ada@example.com",
    ],
    ["nothing, when the row names no one", {}, ""],
  ])("%s", (_case, fields, expected) => {
    expect(accountDisplayName(account(fields))).toBe(expected);
  });
});

describe("principalOf", () => {
  it("is the account id with the row's email and display name", () => {
    expect(
      principalOf(
        account({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
        }),
      ),
    ).toEqual({
      identityId: "ida_ada",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });

  it("the row wins over a claim, field by field", () => {
    expect(
      principalOf(account({ email: "ada@example.com", name: "Ada" }), {
        email: "stale@example.com",
        displayName: "Stale Name",
      }),
    ).toEqual({
      identityId: "ida_ada",
      email: "ada@example.com",
      displayName: "Ada",
    });
  });

  it("a claim fills only what the row leaves empty", () => {
    expect(
      principalOf(account({ firstName: "Ada" }), {
        email: "ada@example.com",
        displayName: "Countess",
      }),
    ).toEqual({
      identityId: "ida_ada",
      email: "ada@example.com",
      displayName: "Ada",
    });
    expect(principalOf(account({}), { displayName: "Countess" })).toEqual({
      identityId: "ida_ada",
      displayName: "Countess",
    });
  });

  it("leaves out a field nothing fills", () => {
    expect(principalOf(account({}), { email: "", displayName: "" })).toEqual({
      identityId: "ida_ada",
    });
  });

  it("a row with no id is a loud fault, never a '' principal", () => {
    expect(() =>
      principalOf(account({ id: "", email: "ada@example.com" })),
    ).toThrow(/no id/);
  });
});

describe("the constructions built on principalOf", () => {
  const ada = account({
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
  });

  it("accountAsCaller is the in-process user with the same principal", () => {
    expect(accountAsCaller(ada)).toEqual({
      identityId: "ida_ada",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      callerClass: "user",
      issuer: "",
      rawToken: "",
    });
  });

  it("accountAsRunnerCaller is the runner with the same principal and its credential", () => {
    expect(accountAsRunnerCaller(ada, "run-token")).toEqual({
      identityId: "ida_ada",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      callerClass: "runner",
      issuer: "",
      rawToken: "run-token",
    });
  });
});

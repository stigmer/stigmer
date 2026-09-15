/**
 * Pins the tuple vocabulary's two contracts: the string notation the
 * cloud's store tests and the IamPolicy proto share round-trips through
 * parse and format, and `personFor` builds the person the evaluator
 * compares against — the account id and the account's issuer subject as
 * aliases, the bare identity for an unprovisioned caller, and
 * a refusal for an identity that names no person, through the same
 * predicate that keeps such stamps out of tuples.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import {
  formatSubject,
  formatTuple,
  parseObjectRef,
  parseSubject,
  personFor,
} from "../tuples.js";

function caller(identityId: string): CallerIdentity {
  return {
    identityId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

describe("the string notation", () => {
  it("parses an object, a userset and the wildcard, and an id may carry a colon (issuer subjects do)", () => {
    expect(parseObjectRef("agent:agt_1")).toEqual({
      type: "agent",
      id: "agt_1",
    });
    expect(parseObjectRef("identity_account:auth0|c:d")).toEqual({
      type: "identity_account",
      id: "auth0|c:d",
    });
    expect(parseSubject("organization:acme#viewer")).toEqual({
      form: "userset",
      object: { type: "organization", id: "acme" },
      relation: "viewer",
    });
    expect(parseSubject("identity_account:*")).toEqual({
      form: "wildcard",
      type: "identity_account",
      condition: undefined,
    });
    expect(parseSubject("identity_account:ida_x")).toEqual({
      form: "object",
      object: { type: "identity_account", id: "ida_x" },
    });
  });

  it("refuses text with no type", () => {
    expect(() => parseObjectRef("nonsense")).toThrow("not an object reference");
    expect(() => parseObjectRef(":id")).toThrow("not an object reference");
  });

  it("formats a tuple in the proto's notation, the condition spelled after `with`", () => {
    expect(
      formatTuple({
        object: parseObjectRef("agent:a"),
        relation: "viewer",
        subject: {
          form: "wildcard",
          type: "identity_account",
          condition: "allow_public",
        },
      }),
    ).toBe("agent:a#viewer@identity_account:* with allow_public");
    expect(formatSubject(parseSubject("organization:acme#member"))).toBe(
      "organization:acme#member",
    );
  });
});

describe("personFor", () => {
  it("a provisioned caller is their account id and the account's issuer subject", () => {
    const account = create(IdentityAccountSchema, {
      metadata: { id: "ida_carol" },
      spec: { idpId: "auth0|carol" },
    });
    const person = personFor(caller("ida_carol"), account);
    expect(person.accountId).toBe("ida_carol");
    expect([...person.aliases].sort()).toEqual(["auth0|carol", "ida_carol"]);
  });

  it("an unprovisioned caller is their identity id alone", () => {
    const person = personFor(caller("auth0|newcomer"), undefined);
    expect(person.accountId).toBe("auth0|newcomer");
    expect([...person.aliases]).toEqual(["auth0|newcomer"]);
  });

  it("refuses an identity that names no person — the empty id and the laptop's placeholder", () => {
    expect(() => personFor(caller(""), undefined)).toThrow("names no person");
    expect(() => personFor(caller("system"), undefined)).toThrow(
      "names no person",
    );
  });
});

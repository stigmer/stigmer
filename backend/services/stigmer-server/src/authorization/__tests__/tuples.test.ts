/**
 * Pins the tuple vocabulary's contract: the string notation the cloud's
 * store tests and the IamPolicy proto share round-trips through parse and
 * format. The person's construction is person.test.ts's.
 */
import { describe, expect, it } from "vitest";

import {
  formatSubject,
  formatTuple,
  parseObjectRef,
  parseSubject,
} from "../tuples.js";

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

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
  it("parses an object and a userset, and an id may carry a colon (issuer subjects do)", () => {
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
    expect(parseSubject("identity_account:ida_x")).toEqual({
      form: "object",
      object: { type: "identity_account", id: "ida_x" },
    });
  });

  it("refuses text with no type", () => {
    expect(() => parseObjectRef("nonsense")).toThrow("not an object reference");
    expect(() => parseObjectRef(":id")).toThrow("not an object reference");
  });

  it("refuses the wildcard notation — no line of the model admits one", () => {
    expect(() => parseSubject("identity_account:*")).toThrow(
      "wildcard subject 'identity_account:*' is not admitted",
    );
  });

  it("formats a tuple in the proto's notation", () => {
    expect(
      formatTuple({
        object: parseObjectRef("agent:a"),
        relation: "viewer",
        subject: {
          form: "userset",
          object: { type: "organization", id: "acme" },
          relation: "viewer",
        },
      }),
    ).toBe("agent:a#viewer@organization:acme#viewer");
    expect(formatSubject(parseSubject("organization:acme#member"))).toBe(
      "organization:acme#member",
    );
  });
});

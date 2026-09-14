/**
 * Pins the one production spelling of an organization-role spec (specs.ts;
 * 20260913.01 slice 4) against the test support's twin, so the rows the
 * built-in role lifecycle and the membership rules write are the rows
 * every test in this domain reads back by derived id — and the zero role
 * is refused before it can be hashed into a row.
 */
import { describe, expect, it } from "vitest";

import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { policyIdFor } from "../constants.js";
import { organizationRole, relationOf } from "../specs.js";
import { orgRole } from "./support.js";

describe("organizationRole — the production spelling of an organization role", () => {
  it.each([
    [IamRole.owner, "owner"],
    [IamRole.admin, "admin"],
    [IamRole.member, "member"],
    [IamRole.viewer, "viewer"],
  ])(
    "role %s spells its relation as %s and derives the same id as the test twin",
    (role, relation) => {
      const spec = organizationRole("ida_alice", role, "acme");
      expect(spec).toEqual(orgRole("ida_alice", relation, "acme"));
      expect(policyIdFor(spec)).toBe(
        policyIdFor(orgRole("ida_alice", relation, "acme")),
      );
    },
  );

  it("the zero role is not a relation — refused, never hashed", () => {
    expect(() => relationOf(IamRole.iam_role_unspecified)).toThrow(
      "iam_role_unspecified is not a relation",
    );
    expect(() =>
      organizationRole("ida_alice", IamRole.iam_role_unspecified, "acme"),
    ).toThrow();
  });
});

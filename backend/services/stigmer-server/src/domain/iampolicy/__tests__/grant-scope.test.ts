/**
 * Pins open source's default PolicyGrantScope (domain/iampolicy/grant-scope.ts;
 * 20260913.01, T01_1_review.md Q-OR-3 and Q-OR-4): the organization grants
 * the roles its `kind_meta` lists and no other kind grants anything.
 * Per-resource grants — a viewer on one agent — are what the Enterprise and
 * Cloud editions add through a composed scope; open source's Members page
 * is the one grant surface this default lights.
 *
 * The contract every scope is held to (extensions/policy-grant-scope.ts),
 * proven here on the default so a composed driver has a shape to match:
 *
 *   - it NARROWS the proto: the organization's answer IS
 *     `grantableRolesFor(organization)`, never a list written in code;
 *   - it is TOTAL over the enum: every other member, the unknown kind
 *     included, answers the empty list and never throws — checkMyPermission
 *     asks the scope about a kind that came off the wire;
 *   - it is SYNCHRONOUS: a proto read, no I/O, so no Promise.
 */
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { grantableRolesFor } from "../../../pipeline/apiresource-meta.js";
import { newOrganizationOnlyGrantScope } from "../grant-scope.js";

describe("newOrganizationOnlyGrantScope — open source grants on organizations only", () => {
  const scope = newOrganizationOnlyGrantScope();

  it("the organization answers exactly the proto's grantable roles", () => {
    const roles = scope.grantableRoles(ApiResourceKind.organization);
    expect(roles).toEqual(grantableRolesFor(ApiResourceKind.organization));
    expect(roles.length).toBeGreaterThan(0);
  });

  it("every other kind answers the empty list — per-resource grants are another edition's", () => {
    for (const value of ApiResourceKindSchema.values) {
      if (value.number === ApiResourceKind.organization) {
        continue;
      }
      expect(
        scope.grantableRoles(value.number as ApiResourceKind),
        value.name,
      ).toEqual([]);
    }
  });

  it("the unknown kind answers the empty list and never throws (total)", () => {
    expect(
      scope.grantableRoles(ApiResourceKind.api_resource_kind_unknown),
    ).toEqual([]);
  });

  it("answers synchronously — a proto read, never a Promise", () => {
    const answer: unknown = scope.grantableRoles(ApiResourceKind.organization);
    expect(answer).not.toBeInstanceOf(Promise);
    expect(Array.isArray(answer)).toBe(true);
  });
});

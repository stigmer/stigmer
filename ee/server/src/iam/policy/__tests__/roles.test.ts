/**
 * Pins grantable-role resolution against the REAL proto kind_meta metadata
 * (the reflection path this module rides) and the grant scope built on
 * it: narrows nothing, total over the enum, synchronous (the three
 * invariants the OSS `PolicyGrantScope` contract states).
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor, newKindMetaPolicyGrantScope } from "../roles.js";

describe("grantable roles from kind_meta", () => {
  it("organizations declare grantable roles in the proto metadata", () => {
    const roles = grantableRolesFor(ApiResourceKind.organization);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles).toContain(IamRole.viewer);
  });

  it("kinds without grantable roles answer the empty list", () => {
    // The platform singleton grants nothing through the user-facing path.
    expect(grantableRolesFor(ApiResourceKind.platform)).toEqual([]);
  });

  it("is total over the enum: the unknown kind and a number outside the enum answer the empty list, never a throw", () => {
    expect(
      grantableRolesFor(ApiResourceKind.api_resource_kind_unknown),
    ).toEqual([]);
    expect(grantableRolesFor(999_999 as ApiResourceKind)).toEqual([]);
  });
});

describe("the PolicyGrantScope built on it (drivers.policyGrantScope)", () => {
  it("narrows nothing: every kind grants exactly its kind_meta roles, synchronously", () => {
    const scope = newKindMetaPolicyGrantScope();
    for (const kind of [
      ApiResourceKind.organization,
      ApiResourceKind.agent,
      ApiResourceKind.agent_channel,
      ApiResourceKind.platform,
      ApiResourceKind.api_resource_kind_unknown,
    ]) {
      expect(scope.grantableRoles(kind)).toEqual(grantableRolesFor(kind));
    }
    // The participant role exists for agent_channel alone (its kind_meta); a scope
    // that dropped it would let the grant succeed while hiding the person
    // from every access listing, a failure no grant test would notice.
    expect(scope.grantableRoles(ApiResourceKind.agent_channel)).toContain(
      IamRole.participant,
    );
  });
});

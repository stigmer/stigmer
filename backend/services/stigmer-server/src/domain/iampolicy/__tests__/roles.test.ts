/**
 * Pins roles.ts (20260913.01 slice 5): the five assignable roles' display
 * metadata and the allowlist that keeps structural relations out of every
 * access listing — moved from the cloud's iam/policy/roles.ts (the Java
 * IamRoleMetadata port). The allowlist is proven by construction here:
 * `participant` must be in it (channel-conversations DD-010), and a
 * structural relation (`organization`, `owner_of`-style links) never is.
 */
import { describe, expect, it } from "vitest";

import {
  assignableRelations,
  isAssignableRole,
  roleInfoFromRelation,
} from "../roles.js";

describe("the assignable-role allowlist", () => {
  it("is exactly the five roles a person can hold, in display order", () => {
    expect(assignableRelations()).toEqual([
      "owner",
      "admin",
      "member",
      "viewer",
      "participant",
    ]);
  });

  it("names a role, never a structural relation", () => {
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("participant")).toBe(true);
    expect(isAssignableRole("organization")).toBe(false);
    expect(isAssignableRole("creator")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
  });
});

describe("roleInfoFromRelation", () => {
  it("carries the Java display metadata: id and code are the relation, name and description the copy", () => {
    const admin = roleInfoFromRelation("admin");
    expect(admin.id).toBe("admin");
    expect(admin.code).toBe("admin");
    expect(admin.name).toBe("Administrator");
    expect(admin.description).toBe(
      "Administrative access with most permissions except ownership transfer",
    );
  });

  it("answers the default instance for a relation that is no role (the Java fromRelationString contract)", () => {
    const unknown = roleInfoFromRelation("organization");
    expect(unknown.code).toBe("");
    expect(unknown.name).toBe("");
  });
});

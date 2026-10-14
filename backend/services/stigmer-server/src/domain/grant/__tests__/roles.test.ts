/**
 * Pins roles.ts: the seven assignable roles' display metadata, read from
 * the contract (each role's `role_meta` name, each kind's
 * `role_descriptions` sentence), and the allowlist that keeps structural
 * relations out of every access listing. The allowlist is proven by
 * construction here: `participant` must be in it (the role that takes part
 * in a channel's or a conversation's conversations), and a structural
 * relation (`organization`, `owner_of`-style links) never is.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  assignableRelations,
  isAssignableRole,
  roleInfoFromRelation,
} from "../roles.js";

describe("the assignable-role allowlist", () => {
  it("is exactly the seven roles a person can hold, in display order", () => {
    expect(assignableRelations()).toEqual([
      "owner",
      "admin",
      "member",
      "viewer",
      "participant",
      "editor",
      "user",
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
  it("names the role from its role_meta and words it for the kind that holds the grant", () => {
    const admin = roleInfoFromRelation("admin", ApiResourceKind.organization);
    expect(admin.id).toBe("admin");
    expect(admin.code).toBe("admin");
    expect(admin.name).toBe("Admin");
    expect(admin.description).toMatch(/^Manage people, settings, billing/);
  });

  it("says what one role means on each kind: Viewer reads a conversation but runs an agent", () => {
    expect(
      roleInfoFromRelation("viewer", ApiResourceKind.session).description,
    ).toBe("Read the conversation; cannot send messages");
    expect(
      roleInfoFromRelation("viewer", ApiResourceKind.agent).description,
    ).toBe("Run it and see how it is set up; cannot change it");
    expect(
      roleInfoFromRelation("participant", ApiResourceKind.session).name,
    ).toBe("Participant");
  });

  it("falls back to the role's kindless sentence on a kind that does not describe it", () => {
    const viewer = roleInfoFromRelation("viewer", ApiResourceKind.api_resource_kind_unknown);
    expect(viewer.name).toBe("Viewer");
    expect(viewer.description).toBe("Read it; cannot change it");
  });

  it("answers the default instance for a relation that is no role (the Java fromRelationString contract)", () => {
    const unknown = roleInfoFromRelation("organization", ApiResourceKind.organization);
    expect(unknown.code).toBe("");
    expect(unknown.name).toBe("");
  });
});

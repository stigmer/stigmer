/**
 * Pins the contract's role words (pipeline/apiresource-meta.ts
 * `roleDescriptionsFor`, iam/v1/enum.proto `role_meta`): every kind that
 * grants roles says what each one means there, one sentence per grantable
 * role and nothing else, and every IamRole value carries its display name.
 * A role a kind grants therefore never reaches a picker or an access list
 * without its words, and a sentence never names a role the kind cannot
 * grant. A change to api_resource_kind.proto that adds a grantable role
 * fails here until its sentence is written.
 */
import { getOption, hasOption } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  IamRole,
  IamRoleSchema,
  role_meta,
} from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor, roleDescriptionsFor } from "../apiresource-meta.js";

const KINDS = ApiResourceKindSchema.values.filter((value) =>
  hasOption(value, kind_meta),
);

describe("roleDescriptionsFor — one sentence per grantable role, per kind", () => {
  it.each(KINDS.map((value) => [value.name, value] as const))(
    "%s describes exactly the roles it grants",
    (_name, value) => {
      const kind = value.number as ApiResourceKind;
      const granted = [...grantableRolesFor(kind)].sort();
      const described =
        getOption(value, kind_meta).authorization?.roleDescriptions ?? [];
      expect([...roleDescriptionsFor(kind).keys()].sort()).toEqual(granted);
      expect(described.map((entry) => entry.role).sort()).toEqual(granted);
      expect(new Set(described.map((entry) => entry.role)).size).toBe(
        described.length,
      );
      for (const entry of described) {
        expect(entry.description.trim()).not.toBe("");
      }
    },
  );

  it("answers the empty map for the unknown kind, never a throw", () => {
    expect(
      roleDescriptionsFor(ApiResourceKind.api_resource_kind_unknown).size,
    ).toBe(0);
  });
});

describe("role_meta — every role has a name and a kindless sentence", () => {
  it.each(
    IamRoleSchema.values
      .filter((value) => value.number !== IamRole.iam_role_unspecified)
      .map((value) => [value.name, value] as const),
  )("%s carries role_meta", (_name, value) => {
    expect(hasOption(value, role_meta)).toBe(true);
    const meta = getOption(value, role_meta);
    expect(meta.displayName.trim()).not.toBe("");
    expect(meta.description.trim()).not.toBe("");
  });
});

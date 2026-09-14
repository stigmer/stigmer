/**
 * Pins `grantableRolesFor` (pipeline/apiresource-meta.ts), the one read of
 * a kind's `kind_meta.authorization.grantable_roles` — what the IamPolicy
 * domain's ValidateGrantableRole consults FIRST (20260913.01, Q-OR-3 as
 * refined: the proto says what can be granted at all; the composed
 * PolicyGrantScope only narrows by edition) and what open source's
 * organization-only scope reads for the organization.
 *
 * Three properties are load-bearing and pinned here rather than assumed:
 *
 *   - The ORGANIZATION lists exactly owner, admin, member, viewer, in the
 *     proto's order. This is the Q-OR-4 ruling made a test: the four roles
 *     every edition grants on an organization are the proto's, not a list
 *     in code, so a change to `api_resource_kind.proto` fails here and
 *     someone reads the ruling before the console shows a fifth word.
 *   - The five system-managed kinds list NO roles. ValidateGrantableRole's
 *     first arm refuses a grant on them with the cloud's byte-pinned
 *     INVALID_ARGUMENT in every edition; this is the data that arm reads.
 *   - TOTAL, never a throw. The reader is asked about the SECOND kind
 *     vocabulary — an `ApiResourceRef.kind` resolved through
 *     `kindByEnumName`, which yields the unknown kind for anything it does
 *     not recognise and never throws (the module header). The unknown kind
 *     is the one enum member without `kind_meta`; it answers the empty
 *     list, as the cloud's `grantableRolesFor` (iam/policy/roles.ts) did.
 */
import { getOption, hasOption } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor } from "../apiresource-meta.js";

describe("grantableRolesFor — the proto's grantable roles per kind", () => {
  it("the organization grants exactly owner, admin, member, viewer, in proto order (Q-OR-4)", () => {
    expect(grantableRolesFor(ApiResourceKind.organization)).toEqual([
      IamRole.owner,
      IamRole.admin,
      IamRole.member,
      IamRole.viewer,
    ]);
  });

  it("a blueprint kind answers the descriptor's own list, not a copy", () => {
    const agentValue = ApiResourceKindSchema.values.find(
      (value) => value.number === ApiResourceKind.agent,
    );
    expect(agentValue).toBeDefined();
    const fromDescriptor =
      getOption(agentValue!, kind_meta).authorization?.grantableRoles ?? [];
    expect(fromDescriptor.length).toBeGreaterThan(0);
    expect(grantableRolesFor(ApiResourceKind.agent)).toEqual(fromDescriptor);
  });

  it.each([
    ["identity_account", ApiResourceKind.identity_account],
    ["api_key", ApiResourceKind.api_key],
    ["iam_policy", ApiResourceKind.iam_policy],
    ["invitation", ApiResourceKind.invitation],
    ["agent_execution", ApiResourceKind.agent_execution],
  ])(
    "%s is system-managed: no grantable roles (Q-OR-3 arm 1)",
    (_name, kind) => {
      expect(grantableRolesFor(kind)).toEqual([]);
    },
  );

  it("the unknown kind answers the empty list and never throws (the second vocabulary's doctrine)", () => {
    expect(
      grantableRolesFor(ApiResourceKind.api_resource_kind_unknown),
    ).toEqual([]);
  });

  it("is total over the descriptor: every member answers an array", () => {
    for (const value of ApiResourceKindSchema.values) {
      const roles = grantableRolesFor(value.number as ApiResourceKind);
      expect(Array.isArray(roles), value.name).toBe(true);
      if (!hasOption(value, kind_meta)) {
        expect(roles, `${value.name} carries no kind_meta`).toEqual([]);
      }
    }
  });
});

/**
 * Pins the role words (`iam-role.ts`) to the generated tables:
 *
 *   - every grantable role on every kind has a sentence of its own, so no
 *     picker shows a role without saying what it means there;
 *   - one role reads differently on different kinds (a Viewer runs an
 *     agent but only reads a conversation);
 *   - a role the kind does not grant falls back to the kindless sentence,
 *     which the deprecated `iamRoleDescription` still returns;
 *   - the display names are the enum's own (`role_meta.display_name`).
 */
import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { GRANTABLE_ROLES } from "../gen/authorization-config.js";
import {
  grantableRoleDescription,
  iamRoleDescription,
  iamRoleDisplayName,
} from "../iam-role.js";

describe("grantableRoleDescription", () => {
  it("gives every grantable role on every kind its own sentence", () => {
    for (const [kind, roles] of GRANTABLE_ROLES) {
      for (const role of roles) {
        const sentence = grantableRoleDescription(kind, role);
        expect(sentence, `${ApiResourceKind[kind]}/${IamRole[role]}`).not.toBe("");
      }
    }
  });

  it("says what a role means on the kind at hand", () => {
    expect(grantableRoleDescription(ApiResourceKind.session, IamRole.viewer)).toBe(
      "Read the conversation; cannot send messages",
    );
    expect(grantableRoleDescription(ApiResourceKind.session, IamRole.participant)).toBe(
      "Read the conversation and send messages",
    );
    expect(grantableRoleDescription(ApiResourceKind.agent, IamRole.viewer)).toBe(
      "Run it and see how it is set up; cannot change it",
    );
  });

  it("falls back to the kindless sentence for a role the kind does not grant", () => {
    expect(grantableRoleDescription(ApiResourceKind.run, IamRole.viewer)).toBe(
      iamRoleDescription(IamRole.viewer),
    );
    expect(grantableRoleDescription(ApiResourceKind.agent, IamRole.iam_role_unspecified)).toBe("");
  });
});

describe("iamRoleDisplayName", () => {
  it("reads the enum's display names", () => {
    expect(iamRoleDisplayName(IamRole.admin)).toBe("Admin");
    expect(iamRoleDisplayName(IamRole.participant)).toBe("Participant");
    expect(iamRoleDisplayName(IamRole.user)).toBe("Can use");
    expect(iamRoleDisplayName(IamRole.iam_role_unspecified)).toBe("Unspecified");
  });
});

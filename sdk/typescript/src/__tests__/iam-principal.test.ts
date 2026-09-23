/**
 * Pins the grantee vocabulary (`iam-principal.ts`) and the team half of the
 * authorization config (`authorization-config.ts`):
 *
 *   - a team is always granted as `team:<id>#member` and a person always
 *     unqualified, because the server's revoke matches the qualifier
 *     exactly and a dropped `#member` revokes nothing while reporting
 *     success;
 *   - reading an access-list entry back is the inverse of building one,
 *     and anything else (a structural principal, another team qualifier)
 *     is refused rather than guessed at;
 *   - a team may only ever be offered a subset of a person's roles, never
 *     `owner`, and nothing on `organization` (the circular grant the
 *     model's membership bound forbids).
 */
import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  getGrantableRoles,
  getTeamGrantableRoles,
  hasTeamGrantableRoles,
  isRoleTeamGrantable,
} from "../authorization-config";
import { TEAM_GRANTABLE_ROLES } from "../gen/authorization-config";
import {
  granteeFromView,
  granteeRef,
  personGrantee,
  teamGrantee,
} from "../iam-principal";

describe("granteeRef — the one spelling of a grantee on the wire", () => {
  it("names a team as its members", () => {
    const ref = granteeRef(teamGrantee("tm_sre"));
    expect([ref.kind, ref.id, ref.relation]).toEqual(["team", "tm_sre", "member"]);
  });

  it("names a person with no relation qualifier", () => {
    const ref = granteeRef(personGrantee("ida_alice"));
    expect([ref.kind, ref.id, ref.relation]).toEqual(["identity_account", "ida_alice", ""]);
  });
});

describe("granteeFromView — reading an access-list entry back", () => {
  it("round-trips both grantees through their wire reference", () => {
    for (const grantee of [teamGrantee("tm_sre"), personGrantee("ida_alice")]) {
      expect(granteeFromView(granteeRef(grantee))).toEqual(grantee);
    }
  });

  it("refuses what it would misname: a team without its members qualifier, a qualified person, a structural principal, an empty id", () => {
    expect(granteeFromView({ kind: "team", id: "tm_sre", relation: "" })).toBeUndefined();
    expect(granteeFromView({ kind: "team", id: "tm_sre", relation: "maintainer" })).toBeUndefined();
    expect(granteeFromView({ kind: "identity_account", id: "ida_alice", relation: "member" })).toBeUndefined();
    expect(granteeFromView({ kind: "organization", id: "acme", relation: "" })).toBeUndefined();
    expect(granteeFromView({ kind: "identity_account", id: "", relation: "" })).toBeUndefined();
  });
});

describe("team grantable roles", () => {
  it("are, for every kind, a subset of the person's roles and never owner", () => {
    for (const [kind, teamRoles] of TEAM_GRANTABLE_ROLES) {
      const personRoles = getGrantableRoles(kind);
      for (const role of teamRoles) {
        expect(personRoles).toContain(role);
        expect(role).not.toBe(IamRole.owner);
      }
    }
  });

  it("list nothing on organization, so an organization is never shared with a team", () => {
    expect(hasTeamGrantableRoles(ApiResourceKind.organization)).toBe(false);
    expect(getTeamGrantableRoles(ApiResourceKind.organization)).toEqual([]);
  });

  it("answer per role on a kind a team may be shared", () => {
    expect(isRoleTeamGrantable(ApiResourceKind.agent, IamRole.viewer)).toBe(true);
    expect(isRoleTeamGrantable(ApiResourceKind.agent, IamRole.owner)).toBe(false);
  });
});

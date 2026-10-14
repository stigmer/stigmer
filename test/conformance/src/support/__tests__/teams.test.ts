// Pins the Team fixtures in support/teams.ts: a team names its organization
// and carries a description; a membership is `member` on the team held by
// the person's account; a share is the role held on the resource by the
// team's members (the `member` qualifier on the team principal); and the
// grant gate's sentence names the account and the organization's slug.
import { describe, expect, it } from "vitest";

import { makeTeam, notAnOrganizationMemberMessage, teamMembership, teamShare } from "../teams";

describe("the team fixtures", () => {
  it("make a team in the organization, with a default description unless one is given", () => {
    expect(makeTeam({ org: "org_1", name: "platform" })).toEqual({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Team",
      metadata: { name: "platform", org: "org_1" },
      spec: { description: "a conformance team" },
    });
    expect(makeTeam({ org: "org_1", name: "platform", description: "ops" }).spec).toEqual({ description: "ops" });
  });

  it("spell a membership as the person holding member on the team", () => {
    const grant = teamMembership("tm_1", "ida_1");
    expect(grant.principal).toMatchObject({ kind: "identity_account", id: "ida_1", relation: "" });
    expect(grant.relation).toBe("member");
    expect(grant.resource).toMatchObject({ kind: "team", id: "tm_1" });
  });

  it("spell a share as the team's members holding the role on the resource", () => {
    const grant = teamShare("tm_1", "viewer", { kind: "agent", id: "agt_1" });
    expect(grant.principal).toMatchObject({ kind: "team", id: "tm_1", relation: "member" });
    expect(grant.relation).toBe("viewer");
    expect(grant.resource).toMatchObject({ kind: "agent", id: "agt_1" });
  });

  it("name the account and the organization's slug when a member add is refused", () => {
    expect(notAnOrganizationMemberMessage("ida_1", "acme")).toBe(
      "identity account 'ida_1' is not a member of organization 'acme'; add them to the organization before adding them to one of its teams",
    );
  });
});

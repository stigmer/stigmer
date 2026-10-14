// Fixtures for the Team domain and the two grants a team takes part in.
// Domain: conformance support.
//
// A team is a named group of an organization's people. Joining one is not a
// Team RPC: a person becomes a member through an IamPolicy grant of
// `member` on `team:<id>`, and a resource is shared with a team as a grant
// whose principal is the team's members (`team:<id>#member`) in one of the
// roles the resource's kind lets a team hold (the agent: editor or viewer).
// The builders spell those triples once, so every arm reads as the grant it
// makes. The team suite and the invitation journey both use them.
//
// The refusal copy below is the proto's own annotation copy
// (apis/ai/stigmer/iam/team/v1/command.proto and query.proto) and the
// Enterprise grant gate's sentence, which a client may match on.
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

import { policyTriple } from "./iampolicies";
import type { InitShape } from "./init-shape";

export const TEAM_API_VERSION = "iam.stigmer.ai/v1";
export const TEAM_KIND = "Team";

// The annotation copy an enforcing Authorizer answers a caller without the
// permission with.
export const TEAM_DENIED = {
  create: "unauthorized to create team in this organization",
  view: "unauthorized to view team",
  list: "unauthorized to list teams in this organization",
} as const;

// A member add naming someone who holds no role in the team's organization.
export function notAnOrganizationMemberMessage(accountId: string, organizationSlug: string): string {
  return `identity account '${accountId}' is not a member of organization '${organizationSlug}'; add them to the organization before adding them to one of its teams`;
}

export function makeTeam(input: { org: string; name: string; description?: string }): InitShape<typeof TeamSchema> {
  return {
    apiVersion: TEAM_API_VERSION,
    kind: TEAM_KIND,
    metadata: { name: input.name, org: input.org },
    spec: { description: input.description ?? "a conformance team" },
  };
}

// `identity_account:<accountId>` holds `member` on `team:<teamId>`.
export function teamMembership(teamId: string, accountId: string): IamPolicySpec {
  return policyTriple({ kind: "identity_account", id: accountId }, "member", { kind: "team", id: teamId });
}

// The team's members hold `role` on the resource.
export function teamShare(teamId: string, role: string, resource: { kind: string; id: string }): IamPolicySpec {
  return policyTriple({ kind: "team", id: teamId, relation: "member" }, role, resource);
}

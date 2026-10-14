/**
 * The organization grant gate: the step on
 * `grant-create:pre-side-effect-gate`, the grant `create` chain
 * after ValidateGrantableRole and before the write. A grant stays inside
 * the organization of the resource it is made on. The model agrees: it
 * admits a direct grant only while its holder is in the object's
 * organization (`[identity_account] and affiliated from organization`), so
 * a grant this gate would let through across an organization would be a
 * row that grants nothing, and an inert row the console lists is a lie
 * about who has access. The grant step has already held a grant to its
 * shape (the `member` qualifier on a team, a role in the kind's
 * `grantable_roles` or `team_grantable_roles`); what it cannot ask is
 * anything that takes a read, and these refusals do:
 *
 *   - a grant naming as principal a team that does not exist, or a team of
 *     another organization than the granted resource (FAILED_PRECONDITION,
 *     one copy for both): otherwise one organization's admins, who decide
 *     who is in their team, would decide who reads another organization's
 *     agent. The model cannot refuse it, because a grant's tuple does not
 *     say which organization it crosses into. The caller administers the
 *     resource, not the team, so the refusal names only the id they sent:
 *     never whether that team exists, its name, or its organization;
 *   - adding an organization's service account to a team
 *     (FAILED_PRECONDITION): a team is a group of the organization's
 *     people, and a service account holds its one organization role and
 *     the resources shared with it directly. One account read, on a member
 *     add only;
 *   - adding someone to a team who is not one of its organization's
 *     viewers (FAILED_PRECONDITION): the membership bound would make the
 *     row inert, and an inert row the console lists is a lie about who is
 *     in the team, so it is refused with the step the person can take;
 *   - adding someone to a team of an organization whose plan does not
 *     include teams (FAILED_PRECONDITION, plan-gate.ts), asked only when
 *     the host fills the plan port. A grant naming a team as principal is
 *     not a member add and is never plan-gated;
 *   - sharing a resource with a person who is not one of its
 *     organization's viewers (FAILED_PRECONDITION), with the step the
 *     sharer can take. The resource's organization is its scope link, the
 *     structural row its creation wrote (the policy store's
 *     `findScopeTuple`); a resource no organization holds has nothing to
 *     stay inside, and a grant on the organization itself is a role, never
 *     a share.
 *
 * The organization questions go to the authorization engine through the
 * composition's query engine, the same instance `drivers.authorizationQueries`
 * serves, so they are asked in the contract's vocabulary and answered by
 * the model the grant will be evaluated by: whether the team's
 * organization is the resource's `organization` (every team-grantable
 * kind has that relation directly), and whether the person is a `viewer`
 * of the team's organization (the relation the bound asks; the role
 * hierarchy is the model's, so no row read could answer it). An engine
 * fault surfaces through the engine's own error mapping, never as a
 * refusal.
 *
 * Every other grant passes without a read: a structural or userset
 * principal on a resource, and an organization role.
 *
 * The two membership refusals name the organization by its slug, the name
 * a person knows it by; the writer administers the team or shares the
 * resource, so it is their own organization. The slug is read once the
 * refusal is certain, over the composition's organization lookup; an
 * organization the lookup no longer answers is named by its id.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type {
  AuthorizationQueryEngine,
  GrantStore,
  IdentityAccountStore,
  PipelineStep,
  RequestContext,
} from "@stigmer/server";
import { failedPreconditionError } from "@stigmer/server";

import type { OrganizationLookup } from "../organization-links.js";
import type { TeamPlanGate } from "./plan-gate.js";
import { teamsNeedAPlan } from "./plan-gate.js";
import { TEAM_KIND_NAME } from "./removal.js";
import type { TeamStore } from "./store.js";

const ORGANIZATION_KIND_NAME = ApiResourceKind[ApiResourceKind.organization];
const ACCOUNT_KIND_NAME = ApiResourceKind[ApiResourceKind.identity_account];

/** The relation every team-grantable kind carries to its organization. */
const ORGANIZATION_RELATION = "organization";
/** The organization relation the membership bound asks. */
const ORGANIZATION_VIEWER_RELATION = "viewer";

export interface OrganizationGrantGateDeps {
  readonly teams: Pick<TeamStore, "findById">;
  readonly queries: Pick<AuthorizationQueryEngine, "check">;
  /** The resource's scope link: which organization a shared resource belongs to. */
  readonly scopes: Pick<GrantStore, "findScopeTuple">;
  /** The organization's slug, for a refusal's copy. */
  readonly organizations: Pick<OrganizationLookup, "find">;
  /** The host's plan gate; absent, every organization may add team members. */
  readonly plan?: TeamPlanGate;
  /** The account a member add names: a service account is never a member. */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
}

/** A team member add naming a service account (FAILED_PRECONDITION). */
export function serviceAccountNotATeamMemberMessage(accountId: string): string {
  return `identity account '${accountId}' is a service account; a team is a group of the organization's people, so share resources with the service account directly`;
}

export function newOrganizationGrantGateStep(
  deps: OrganizationGrantGateDeps,
): PipelineStep<typeof GrantSpecSchema> {
  return {
    name: "OrganizationGrantGate",
    async execute(
      ctx: RequestContext<typeof GrantSpecSchema>,
    ): Promise<void> {
      const { principal, resource } = ctx.input;
      if (principal === undefined || resource === undefined) {
        return;
      }
      if (principal.kind === TEAM_KIND_NAME) {
        await requireTeamOfResourceOrganization(deps, principal.id, resource);
        return;
      }
      if (resource.kind === TEAM_KIND_NAME) {
        const team = await requireTeam(deps, resource.id);
        await requirePlanWithTeams(deps, team);
        // Membership first: a person of another organization is refused as
        // such, whatever kind of account their id names.
        await requireOrganizationViewer(deps, team, principal);
        await refuseServiceAccountMember(deps, principal);
        return;
      }
      if (
        principal.kind === ACCOUNT_KIND_NAME &&
        principal.relation === "" &&
        resource.kind !== ORGANIZATION_KIND_NAME
      ) {
        await requirePersonInResourceOrganization(deps, principal, resource);
      }
    },
  };
}

async function requireTeam(
  deps: OrganizationGrantGateDeps,
  id: string,
): Promise<Team> {
  const team = await deps.teams.findById(id);
  if (team === undefined) {
    throw new ConnectError(`team '${id}' does not exist`, Code.NotFound);
  }
  return team;
}

/** The principal team exists and is the granted resource's organization's, or one refusal for either. */
async function requireTeamOfResourceOrganization(
  deps: OrganizationGrantGateDeps,
  id: string,
  resource: ApiResourceRef,
): Promise<void> {
  const team = await deps.teams.findById(id);
  if (team === undefined || !(await sameOrganization(deps, team, resource))) {
    throw failedPreconditionError(
      `team '${id}' is not a team of this resource's organization, and a team can be granted only on its own organization's resources`,
    );
  }
}

async function sameOrganization(
  deps: OrganizationGrantGateDeps,
  team: Team,
  resource: ApiResourceRef,
): Promise<boolean> {
  return deps.queries.check(
    create(GrantSpecSchema, {
      principal: ref(ORGANIZATION_KIND_NAME, team.metadata?.org ?? ""),
      relation: ORGANIZATION_RELATION,
      resource,
    }),
    [],
  );
}

async function requirePlanWithTeams(deps: OrganizationGrantGateDeps, team: Team): Promise<void> {
  const org = team.metadata?.org ?? "";
  if (deps.plan !== undefined && !(await deps.plan.allowsTeams(org))) {
    throw teamsNeedAPlan(org);
  }
}

async function refuseServiceAccountMember(
  deps: OrganizationGrantGateDeps,
  member: ApiResourceRef,
): Promise<void> {
  // A team's member is an account (the grant step's shape check), so the
  // one read answers whichever account it names.
  const account = await deps.accounts.findById(member.id);
  if (
    account?.spec?.provisioningMode ===
    IdentityAccountProvisioningMode.service_account
  ) {
    throw failedPreconditionError(serviceAccountNotATeamMemberMessage(member.id));
  }
}

async function requireOrganizationViewer(
  deps: OrganizationGrantGateDeps,
  team: Team,
  person: ApiResourceRef,
): Promise<void> {
  const org = team.metadata?.org ?? "";
  if (!(await isOrganizationViewer(deps, person, org))) {
    throw failedPreconditionError(
      `identity account '${person.id}' is not a member of organization '${await slugOf(deps, org)}'; add them to the organization before adding them to one of its teams`,
    );
  }
}

async function requirePersonInResourceOrganization(
  deps: OrganizationGrantGateDeps,
  person: ApiResourceRef,
  resource: ApiResourceRef,
): Promise<void> {
  const link = await deps.scopes.findScopeTuple(resource.kind, resource.id);
  const parent = link?.spec?.principal;
  if (parent === undefined || parent.kind !== ORGANIZATION_KIND_NAME) {
    return;
  }
  if (!(await isOrganizationViewer(deps, person, parent.id))) {
    throw failedPreconditionError(
      `identity account '${person.id}' is not a member of organization '${await slugOf(deps, parent.id)}'; add them to the organization before sharing its resources with them`,
    );
  }
}

/** The name a refusal gives the organization: its slug, or its id when the lookup answers none. */
async function slugOf(deps: OrganizationGrantGateDeps, organizationId: string): Promise<string> {
  const slug = (await deps.organizations.find(organizationId))?.slug ?? "";
  return slug === "" ? organizationId : slug;
}

/** Whether the person is one of the organization's viewers, asked of the model. */
function isOrganizationViewer(
  deps: OrganizationGrantGateDeps,
  person: ApiResourceRef,
  organizationId: string,
): Promise<boolean> {
  return deps.queries.check(
    create(GrantSpecSchema, {
      principal: ref(ACCOUNT_KIND_NAME, person.id),
      relation: ORGANIZATION_VIEWER_RELATION,
      resource: ref(ORGANIZATION_KIND_NAME, organizationId),
    }),
    [],
  );
}

function ref(kind: string, id: string): ApiResourceRef {
  return create(ApiResourceRefSchema, { kind, id });
}

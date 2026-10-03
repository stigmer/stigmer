/**
 * IamPolicy pipeline steps: the domain-local
 * steps the six command chains splice after the shared `Authorize` and
 * `ValidateProto`. The write itself is never here — every step that writes
 * calls the ONE grant and revoke path (grant-path.ts, which owns the
 * row-and-tuple orderings, the by-triple read and the wire refusals) and leaves
 * its answer under POLICY_RESULT_KEY for the handler. The chains are
 * deliberately short: `Authorize → ValidateProto → <one of these>`, with
 * only the owner steps (the last section) before the write on the three
 * caller lanes, so the pipeline executor's fault mapping (a step's ConnectError keeps its code;
 * a raw store fault becomes the sanitized INTERNAL) covers the path's two
 * error shapes with no second idiom in the handlers.
 *
 * ValidateGrantableRole (the `create` chain only; `bootstrapPolicy` is the
 * structural lane and skips it) is the one step with branching logic. It
 * runs BEFORE Grant — the cloud's validate-before-write order, so a held
 * legacy row under a role the kind does not grant is refused rather than
 * answered as a duplicate — and reads, in this order:
 *   1. the wire refusals: an unknown resource kind is `Unknown resource
 *      kind`, never a role sentence — the second line behind the
 *      controller's pre-position-1 refusal, kept so the step's
 *      own contract holds for whoever splices it;
 *   2. the PROTO (`grantableRolesFor`): a kind that lists no role is
 *      system-managed in every edition — the cloud's byte-pinned copy,
 *      whatever the composed scope claims;
 *   3. the composed SCOPE: a kind it lists nothing for is a per-resource
 *      grant this edition does not serve — UNIMPLEMENTED naming the
 *      editions that do;
 *   4. proto ∩ scope, in proto order: the role must be in the
 *      intersection — the cloud's second copy listing it. Intersecting is
 *      what keeps a scope from WIDENING the contract by accident;
 *   5. the PRINCIPAL (since 2026-09-14; constants.ts
 *      USER_GRANT_PRINCIPAL_KINDS): a person grants roles to people and to
 *      teams of people, and to nothing else. A row whose principal is a
 *      resource is a structural link (the hierarchy walk's parent edge),
 *      which is `bootstrapPolicy`'s to write; through this lane it would
 *      let a right on one organization read another's members. Last, so
 *      every answer the cloud's create gives today is unchanged and only
 *      the row it should never have written is refused. A person names no
 *      relation qualifier: `identity_account:<id>#<anything>` names
 *      nobody, and OpenFGA would refuse the tuple after the row was
 *      written, a grant on paper that is denied in practice.
 *
 * A TEAM principal takes its own list in place of arm 4: the kind's
 * `team_grantable_roles` ∩ scope, never the person list, because a team
 * is granted only what its members could each be granted and never
 * ownership. It must name the team's members (`TEAM_MEMBERS_RELATION`).
 * A kind that lists no team role refuses a team whatever the role, so
 * open source (organization-only scope, and `organization` lists none)
 * grants a team nothing without a branch of its own. Whether the team
 * exists and belongs to the resource's organization needs a read, which
 * this synchronous step does not make: that is the
 * `iam-policy-create:pre-side-effect-gate` slot's, spliced after it.
 *
 * Owner is assigned by owners. Every caller of the member lanes holds
 * `can_grant_access` (admin) already, so an admin grants every role up to
 * admin; a change that touches an organization's `owner` role also needs
 * `can_assign_roles` there, which only its owners hold. Two steps carry it,
 * on the caller lanes only (`create`, `delete`, `revokeOrgAccess`; never
 * the bootstrap twins, whose platform-pipeline callers hold no
 * organization role):
 *   - AuthorizeOwnerAssignment asks `can_assign_roles` when the spec grants
 *     or revokes `owner` on an organization, or when the account
 *     `revokeOrgAccess` removes holds it. It is Authorize's own evaluation
 *     (`authorizeResolvedResource`), so the `internal` caller skips it as it
 *     skips position 1;
 *   - KeepOneOwner refuses a revoke or a removal that would leave the
 *     organization with no owner. It is a product rule rather than
 *     authorization, so it is its own step. It skips `internal` too. The
 *     port has no transaction, so two owners removing each other at the
 *     same instant can both pass; each still needed `can_assign_roles`.
 * Both read the organization's owner rows once per request
 * (`organizationOwners`). They do not govern the grants that follow
 * configuration rather than a caller (the organization creator's row, the
 * membership rules, the trusted-local operator), which call the grant path
 * directly, nor an edition's in-process doors that grant a role on a
 * person's behalf (an invitation's redemption, an identity provider's
 * auto-grant), which run as `internal` and hold the same rule at their own
 * sites.
 */
import { create, type DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { RevokeOrgAccessInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type {
  ApiResourceRef,
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamPermission, IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { PolicyGrantScope } from "../../extensions/policy-grant-scope.js";
import {
  grantableRolesFor,
  kindEnumName,
  teamGrantableRolesFor,
} from "../../pipeline/apiresource-meta.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import {
  LAST_OWNER_MESSAGE,
  OWNER_ASSIGNMENT_DENIED_MESSAGE,
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  TEAM_MEMBERS_RELATION,
  noGrantableRolesMessage,
  personQualifierMessage,
  principalNotGrantableMessage,
  roleNotGrantableMessage,
  teamNotGrantableMessage,
  teamQualifierMessage,
  teamRoleNotGrantableMessage,
} from "./constants.js";
import type { PolicyChangeCause } from "./change.js";
import type { IamPolicyGrantPath } from "./grant-path.js";
import type { IamPolicyStore } from "./store.js";
import {
  requireKnownPrincipalKind,
  requireKnownResourceKind,
} from "./wire-refusals.js";

/** The row a write chain answers — the granted row, or the revoked row (the default instance when there was none). */
export const POLICY_RESULT_KEY = "policyResult";

/** The `create` chain's role check; see the module header for the four arms. */
export function newValidateGrantableRoleStep(
  scope: PolicyGrantScope,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "ValidateGrantableRole",
    execute(ctx: RequestContext<typeof IamPolicySpecSchema>): void {
      const spec = ctx.input;
      const kindName = spec.resource?.kind ?? "";
      const kind = requireKnownResourceKind(kindName);
      const contract = grantableRolesFor(kind);
      if (contract.length === 0) {
        throw new ConnectError(
          noGrantableRolesMessage(kindName),
          Code.InvalidArgument,
        );
      }
      const scoped = new Set(scope.grantableRoles(kind));
      if (scoped.size === 0) {
        throw new ConnectError(
          PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
          Code.Unimplemented,
        );
      }
      const principal = spec.principal;
      if (principal?.kind === TEAM_KIND_NAME) {
        requireTeamGrant(
          spec.relation,
          principal.relation,
          kind,
          kindName,
          scoped,
        );
        return;
      }
      const grantable = contract.filter((role) => scoped.has(role));
      if (!grantable.some((role) => IamRole[role] === spec.relation)) {
        throw new ConnectError(
          roleNotGrantableMessage(
            spec.relation,
            kindName,
            grantable.map((role) => IamRole[role]),
          ),
          Code.InvalidArgument,
        );
      }
      const principalKindName = principal?.kind ?? "";
      const principalKind = requireKnownPrincipalKind(principalKindName);
      if (principalKind !== ApiResourceKind.identity_account) {
        throw new ConnectError(
          principalNotGrantableMessage(principalKindName),
          Code.InvalidArgument,
        );
      }
      const qualifier = principal?.relation ?? "";
      if (qualifier !== "") {
        throw new ConnectError(
          personQualifierMessage(qualifier),
          Code.InvalidArgument,
        );
      }
    },
  };
}

/** The wire name of the team kind, as an `ApiResourceRef.kind` carries it. */
const TEAM_KIND_NAME = kindEnumName(ApiResourceKind.team);

/**
 * The team arm of ValidateGrantableRole (the module header): the role
 * against the kind's team list narrowed by the scope, then the qualifier.
 */
function requireTeamGrant(
  role: string,
  qualifier: string,
  kind: ApiResourceKind,
  kindName: string,
  scoped: ReadonlySet<IamRole>,
): void {
  const teamGrantable = teamGrantableRolesFor(kind).filter((r) =>
    scoped.has(r),
  );
  if (teamGrantable.length === 0) {
    throw new ConnectError(
      teamNotGrantableMessage(kindName),
      Code.InvalidArgument,
    );
  }
  if (!teamGrantable.some((r) => IamRole[r] === role)) {
    throw new ConnectError(
      teamRoleNotGrantableMessage(
        role,
        kindName,
        teamGrantable.map((r) => IamRole[r]),
      ),
      Code.InvalidArgument,
    );
  }
  if (qualifier !== TEAM_MEMBERS_RELATION) {
    throw new ConnectError(
      teamQualifierMessage(qualifier),
      Code.InvalidArgument,
    );
  }
}

/** Grant the spec as the chain's caller, through the chain's door; the row (fresh or held) is the result. */
export function newGrantStep(
  grantPath: IamPolicyGrantPath,
  cause: PolicyChangeCause,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "Grant",
    async execute(
      ctx: RequestContext<typeof IamPolicySpecSchema>,
    ): Promise<void> {
      const { policy } = await grantPath.grant(
        ctx.input,
        ctx.callerIdentity,
        cause,
      );
      ctx.set(POLICY_RESULT_KEY, policy);
    },
  };
}

/** Revoke the spec's row as the chain's caller; absent, the default instance is the result (Java's idempotent delete). */
export function newRevokeStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "Revoke",
    async execute(
      ctx: RequestContext<typeof IamPolicySpecSchema>,
    ): Promise<void> {
      const revoked = await grantPath.revokeBySpec(
        ctx.input,
        ctx.callerIdentity,
      );
      ctx.set(POLICY_RESULT_KEY, revoked ?? create(IamPolicySchema));
    },
  };
}

/** Revoke every relation the account holds directly on the organization. */
export function newRevokeOrgAccessStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof RevokeOrgAccessInputSchema> {
  return {
    name: "RevokeOrgAccess",
    execute(
      ctx: RequestContext<typeof RevokeOrgAccessInputSchema>,
    ): Promise<void> {
      return grantPath.revokeOrgAccess(
        ctx.input.identityAccountId,
        ctx.input.org,
        ctx.callerIdentity,
      );
    },
  };
}

/** Revoke every row naming the ref as resource or principal — the deleted resource's cleanup. */
export function newCleanupResourceStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof ApiResourceRefSchema> {
  return {
    name: "CleanupResource",
    execute(ctx: RequestContext<typeof ApiResourceRefSchema>): Promise<void> {
      const ref: ApiResourceRef = ctx.input;
      return grantPath.cleanupResource(ref, ctx.callerIdentity);
    },
  };
}

// ---------------------------------------------------------------------------
// Owner is assigned by owners (the module header's last section)
// ---------------------------------------------------------------------------

/** The wire names the two owner steps compare against. */
const ORGANIZATION_KIND_NAME = kindEnumName(ApiResourceKind.organization);
const IDENTITY_ACCOUNT_KIND_NAME = kindEnumName(ApiResourceKind.identity_account);
const OWNER_RELATION = IamRole[IamRole.owner];

/** The context key the organization's owner rows are kept under for the rest of the request. */
const ORGANIZATION_OWNERS_KEY = "organizationOwners";

/** An organization owner role a request would grant or remove, and whose it is. */
export interface OwnerRoleChange {
  readonly organizationId: string;
  readonly accountId: string;
}

/**
 * The ids of the people holding `owner` on the organization, read once per
 * request and shared by both owner steps: the organization's `owner` rows
 * whose principal is a person, the only principal the model admits there.
 */
async function organizationOwners<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  policies: IamPolicyStore,
  organizationId: string,
): Promise<ReadonlySet<string>> {
  const held = ctx.get(ORGANIZATION_OWNERS_KEY);
  if (held instanceof Set) {
    return held as ReadonlySet<string>;
  }
  const rows = await policies.findByResourceWithRelations(
    ORGANIZATION_KIND_NAME,
    organizationId,
    [OWNER_RELATION],
  );
  const owners = new Set(
    rows
      .map((row) => row.spec?.principal)
      .filter((principal) => principal?.kind === IDENTITY_ACCOUNT_KIND_NAME)
      .map((principal) => principal?.id ?? ""),
  );
  ctx.set(ORGANIZATION_OWNERS_KEY, owners);
  return owners;
}

/** `create` and `delete`: the spec names the change; nothing is read. */
export function specOwnerRoleChange(
  ctx: RequestContext<typeof IamPolicySpecSchema>,
): Promise<OwnerRoleChange | undefined> {
  const { resource, principal, relation } = ctx.input;
  if (resource?.kind !== ORGANIZATION_KIND_NAME || relation !== OWNER_RELATION) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve({
    organizationId: resource.id,
    accountId: principal?.id ?? "",
  });
}

/** `revokeOrgAccess`: the removal touches owner exactly when the account holds it. */
export function orgAccessOwnerRoleChange(
  policies: IamPolicyStore,
): (
  ctx: RequestContext<typeof RevokeOrgAccessInputSchema>,
) => Promise<OwnerRoleChange | undefined> {
  return async (ctx) => {
    const { identityAccountId, org: organizationId } = ctx.input;
    const owners = await organizationOwners(ctx, policies, organizationId);
    return owners.has(identityAccountId)
      ? { organizationId, accountId: identityAccountId }
      : undefined;
  };
}

/** A change touching an organization's owner role needs `can_assign_roles` there; see the module header. */
export function newAuthorizeOwnerAssignmentStep<Desc extends DescMessage>(
  authorizer: Authorizer,
  ownerRoleChange: (ctx: RequestContext<Desc>) => Promise<OwnerRoleChange | undefined>,
): PipelineStep<Desc> {
  return {
    name: "AuthorizeOwnerAssignment",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      const change = await ownerRoleChange(ctx);
      if (change === undefined) {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: IamPermission.can_assign_roles,
          resourceKind: ApiResourceKind.organization,
          resourceId: change.organizationId,
        },
        OWNER_ASSIGNMENT_DENIED_MESSAGE,
      );
    },
  };
}

/** A revoke or removal may not leave the organization with no owner; see the module header. */
export function newKeepOneOwnerStep<Desc extends DescMessage>(
  policies: IamPolicyStore,
  ownerRoleChange: (ctx: RequestContext<Desc>) => Promise<OwnerRoleChange | undefined>,
): PipelineStep<Desc> {
  return {
    name: "KeepOneOwner",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      const change = await ownerRoleChange(ctx);
      if (change === undefined) {
        return;
      }
      const owners = await organizationOwners(ctx, policies, change.organizationId);
      if (owners.has(change.accountId) && owners.size === 1) {
        throw new ConnectError(LAST_OWNER_MESSAGE, Code.FailedPrecondition);
      }
    },
  };
}

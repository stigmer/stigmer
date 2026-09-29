/**
 * The ONE grant and revoke path of the IamPolicy domain (20260913.01,
 * T01_0_plan.md §3a; T01_1_review.md Q-OR-1), moved from the cloud's
 * iam/policy/service.ts into open source so every edition writes and
 * deletes a policy row the same way. Its callers: the IamPolicy command
 * controller (user grants and the three system RPCs), the built-in role
 * lifecycle (the organization creator's `owner` row; cleanup on delete)
 * and the membership rules (first-sign-in roles). Nothing else builds,
 * saves or deletes a policy row; a composition reaches this path as
 * in-process RPCs, never through an exported constructor.
 *
 * The two cloud#425 ordering invariants live here, nowhere else:
 *   CREATE: row before tuple — a crash between the two leaves
 *     row-without-tuple (granted on paper, denied in practice), healed by
 *     the caller's natural retry (the tuple write deliberately runs on
 *     duplicates too — the inline heal) or the boot backfill.
 *   DELETE: tuple before row — a crash leaves row+tuple (revoke failed,
 *     retry works); the reverse order was the fail-open incident class
 *     ("revoke access" silently becoming "keep access forever").
 * "Tuple" here is whatever the composed ResourceAuthorizationLifecycle does
 * in `onPolicyGranted` and `onPolicyRevoked`; with none composed, or one
 * without the two optional hooks, the path writes rows and notifies
 * nothing (the OSS posture: rows are the record).
 *
 * The row for a triple is found BY TRIPLE, never by derived id. Open
 * source's rows carry the derived id (constants.ts policyIdFor), so the
 * two lookups would agree here; the cloud's Java-era rows carry random
 * `iamp_<ulid>` ids and must revoke and deduplicate through this same
 * code, so `findByTriple` (the pair's rows filtered by relation) is the
 * one definition of "the row for this triple" and `findById` serves the
 * `get` RPC alone. On the OSS adapter that read is one scan of the kind
 * (resource-store.ts); §4 measures it.
 *
 * The path is the one writer, so it refuses before it writes (Q-S2-1;
 * slice 1 ruling 2): before any read, write or hook, `grant` and
 * `revokeBySpec` run the domain's wire refusals (wire-refusals.ts — a spec
 * whose resource or principal kind is not an ApiResourceKind member name,
 * or whose fields hold a canonical-text delimiter, is INVALID_ARGUMENT
 * with the pinned copy; slice 5 made that module the one home of the rule
 * the controller and the ValidateGrantableRole step share). The
 * controller refuses the same kinds BEFORE position 1 (Q-S6-1), so a wire
 * caller never reaches this check; it stands for the callers that enter
 * here without the controller — the built-in lifecycle and the membership
 * rules — and is what keeps a garbage row out of the store and a garbage
 * spec away from a composition's tuple delete from every door.
 * `cleanupResource` and `revokeOrgAccess` take refs and ids their callers
 * read from rows, so they do not refuse.
 *
 * Leaving an organization. The model bounds every direct grant on an
 * organization-scoped object by the organization (`[identity_account]
 * and affiliated from organization`, fga/model/tenancy/organization.fga),
 * so a person with no role left in an organization reaches nothing in it
 * on the next check. This path keeps the ROWS truthful to that: when a
 * revoke leaves an account with no row on an organization, it revokes the
 * rows the account holds on that organization's resources (a share, a
 * team membership, an owner granted by someone else), each through the
 * revoke order, so a departed person is listed nowhere and a return does
 * not bring the shares back. It keeps AUTHORSHIP: an `owner` or `creator`
 * row whose principal is the resource's recorded creator, exactly the
 * tuple open source derives from the creator stamp instead of storing it
 * (authorization/derived-tuples.ts), so both editions keep the same fact
 * and the model's bound governs it in both. `revokeOrgAccess` always
 * sweeps, so a retry after a crash mid-sweep converges; `revokeBySpec`
 * sweeps when the row it revoked was the account's last on that
 * organization; `cleanupResource` never sweeps (an organization's or an
 * account's delete, where the bound already leaves every row inert and a
 * sweep per member would add failure points to a delete that stops on
 * the first fault). A resource's organization is read from the scope
 * links the rows hold (`resolveHierarchy`); open source writes none and
 * grants nothing below the organization (grant-scope.ts), so there the
 * sweep finds nothing to do.
 *
 * Affiliation. The model's bound reads `organization#affiliated`, a stored
 * relation that stands exactly while the person holds a row on the
 * organization. This path is the one writer of those rows, so it announces
 * every change of them through the lifecycle and never decides the answer
 * itself: `onOrganizationAffiliationChanging` before a row naming an
 * account on an organization is deleted (the driver removes the tuple
 * first, fail-closed), `onOrganizationAffiliationChanged` after such a row
 * is written or deleted (the driver re-derives the tuple from the committed
 * rows). `affiliated` itself is refused as a grant on every lane; it is
 * derived, never granted.
 *
 * The row this path builds: the proto's apiVersion const and kind, the
 * derived id, the spec as given, and the caller's audit stamp through the
 * platform's one stamper (setAuditFieldsForCreate) — the cloud's
 * `buildNewPolicy` stamped neither org nor creator; this path stamps the
 * creator and, like the cloud, no `metadata.org`, because a policy may
 * span organizations and none owns it.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  OrganizationAffiliationEvent,
  ResourceAuthorizationLifecycle,
} from "../../extensions/resource-authorization.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import {
  AFFILIATION_NOT_GRANTABLE_MESSAGE,
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "./constants.js";
import { resolveHierarchy } from "./access-lists.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";
import { refsOf, requireWellFormedTriple } from "./wire-refusals.js";

/** The relation `cleanupResource` revokes last on the ref's own rows. */
const OWNER_RELATION = IamRole[IamRole.owner];

const ACCOUNT_KIND = kindEnumName(ApiResourceKind.identity_account);
const ORGANIZATION_KIND = kindEnumName(ApiResourceKind.organization);

/** The organization relation derived from a person's roles (fga/model/tenancy/organization.fga). */
const AFFILIATED_RELATION = "affiliated";

/**
 * The (account, organization) pair a row's affiliation hangs on, or
 * undefined when the row is not a person's row on an organization (a
 * structural link, a userset principal, a row on any other kind).
 */
function affiliationOf(
  spec: IamPolicySpec,
): OrganizationAffiliationEvent | undefined {
  const principal = spec.principal;
  const resource = spec.resource;
  if (
    principal === undefined ||
    resource === undefined ||
    principal.kind !== ACCOUNT_KIND ||
    principal.relation !== "" ||
    resource.kind !== ORGANIZATION_KIND
  ) {
    return undefined;
  }
  return { identityAccountId: principal.id, organizationId: resource.id };
}

/**
 * The relations a resource's creation records for its creator: `owner`
 * on a kind whose owner is its creator, `creator` on a kind that also
 * records one (the proto's `requires_creator_tuple`). The removal sweep
 * keeps these when they name the resource's recorded creator.
 */
const AUTHORSHIP_RELATIONS: ReadonlySet<string> = new Set([
  OWNER_RELATION,
  "creator",
]);

export interface GrantResult {
  readonly policy: IamPolicy;
  /** True when the triple was already held: no row was written, the hook still fired. */
  readonly duplicate: boolean;
}

export interface IamPolicyGrantPath {
  /**
   * Grant the triple as `caller`: gate, find by triple, write the row when
   * absent (the caller's audit stamp), then `onPolicyGranted` — on the
   * duplicate arm too. A hook throw fails the grant with the row in place.
   */
  grant(spec: IamPolicySpec, caller: CallerIdentity): Promise<GrantResult>;
  /**
   * Revoke the triple: gate, find by triple, `onPolicyRevoked` (with the
   * row, or with the spec alone on the absent arm), then delete the row.
   * A hook throw leaves row and tuple. Answers the revoked row, or
   * `undefined` when there was none.
   */
  revokeBySpec(spec: IamPolicySpec): Promise<IamPolicy | undefined>;
  /**
   * Revoke every row naming the ref as its principal, then every row naming
   * it as its resource with the `owner` rows last, each through the revoke
   * order; a row that is both is revoked once. Nothing to clean is a no-op.
   * The order matters where the ref still exists: an organization's delete
   * runs this before its row goes and fails on the first fault, so a
   * cleanup that stops partway has not yet removed the owners who may
   * retry it.
   */
  cleanupResource(ref: ApiResourceRef): Promise<void>;
  /**
   * Revoke every relation the account holds directly on the organization,
   * then every row it holds on the organization's resources except its
   * authorship (the module header's sweep).
   */
  revokeOrgAccess(
    identityAccountId: string,
    organizationId: string,
  ): Promise<void>;
}

/**
 * The recorded creator of a stored resource, the one fact the removal
 * sweep needs from outside the policy rows.
 */
export interface ResourceCreators {
  /**
   * The row's `status.audit.spec_audit.created_by.id`, or undefined when
   * this server stores no row of that kind and id.
   */
  creatorOf(kind: string, id: string): Promise<string | undefined>;
}

export interface IamPolicyGrantPathDeps {
  readonly policies: IamPolicyStore;
  readonly creators: ResourceCreators;
  /** The composed driver, if any; a driver without the two policy hooks is the same as none. */
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

export function newIamPolicyGrantPath(
  deps: IamPolicyGrantPathDeps,
): IamPolicyGrantPath {
  const { policies, creators, lifecycle, logger } = deps;

  /** The row holding this exact triple — the pair's rows, filtered by relation. */
  async function findByTriple(
    spec: IamPolicySpec,
  ): Promise<IamPolicy | undefined> {
    const { principal, resource } = refsOf(spec);
    const onPair = await policies.findByPrincipalAndResource(
      principal.kind,
      principal.id,
      resource.kind,
      resource.id,
    );
    return onPair.find(
      (policy) =>
        policy.spec !== undefined &&
        policy.spec.relation === spec.relation &&
        policy.spec.principal?.relation === principal.relation,
    );
  }

  /** The revoke order for one row: the hook, then the delete. */
  async function revokeRow(policy: IamPolicy): Promise<void> {
    const spec = policy.spec;
    if (spec === undefined) {
      throw new Error(
        `policy ${policy.metadata?.id ?? "?"} has no spec — corrupt row`,
      );
    }
    const affiliation = affiliationOf(spec);
    if (affiliation !== undefined) {
      await lifecycle?.onOrganizationAffiliationChanging?.(affiliation);
    }
    await lifecycle?.onPolicyRevoked?.({ spec, policy });
    const id = policy.metadata?.id ?? "";
    await policies.deleteById(id);
    logger.info("iam policy revoked", fieldsOf(id, spec));
    if (affiliation !== undefined) {
      await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
    }
  }

  /** Whether the account still holds any row on the organization. */
  async function holdsOrganizationRow(
    accountId: string,
    organizationId: string,
  ): Promise<boolean> {
    const held = await policies.findByPrincipal(ACCOUNT_KIND, accountId);
    return held.some(
      (policy) =>
        policy.spec?.resource?.kind === ORGANIZATION_KIND &&
        policy.spec.resource.id === organizationId,
    );
  }

  /** Whether the row records the resource's creator as its author. */
  async function isAuthorship(
    policy: IamPolicy,
    accountId: string,
  ): Promise<boolean> {
    const spec = policy.spec;
    if (
      spec?.resource === undefined ||
      !AUTHORSHIP_RELATIONS.has(spec.relation)
    ) {
      return false;
    }
    const creator = await creators.creatorOf(
      spec.resource.kind,
      spec.resource.id,
    );
    return creator === accountId;
  }

  /** Revoke what the account holds on the organization's resources, authorship kept. */
  async function sweepOrganization(
    accountId: string,
    organizationId: string,
  ): Promise<void> {
    const held = await policies.findByPrincipal(ACCOUNT_KIND, accountId);
    let revoked = 0;
    for (const policy of held) {
      const resource = policy.spec?.resource;
      if (resource === undefined || resource.kind === ORGANIZATION_KIND) {
        continue;
      }
      const hierarchy = await resolveHierarchy(
        policies,
        resource.kind,
        resource.id,
        true,
      );
      const inOrganization = hierarchy.some(
        (level) =>
          level.kind === ORGANIZATION_KIND && level.id === organizationId,
      );
      if (!inOrganization || (await isAuthorship(policy, accountId))) {
        continue;
      }
      await revokeRow(policy);
      revoked++;
    }
    if (revoked > 0) {
      logger.info("iam policy organization access swept", {
        identityAccountId: accountId,
        organizationId,
        revoked: String(revoked),
      });
    }
  }

  return {
    async grant(spec, caller): Promise<GrantResult> {
      requireWellFormedTriple(spec);
      if (
        spec.relation === AFFILIATED_RELATION &&
        spec.resource?.kind === ORGANIZATION_KIND
      ) {
        throw new ConnectError(
          AFFILIATION_NOT_GRANTABLE_MESSAGE,
          Code.InvalidArgument,
        );
      }
      let policy = await findByTriple(spec);
      let duplicate = policy !== undefined;
      if (policy === undefined) {
        const fresh = buildRow(spec, caller);
        try {
          await policies.save(fresh);
          policy = fresh;
          logger.info("iam policy granted", fieldsOf(policyIdFor(spec), spec));
        } catch (error) {
          if (!(error instanceof DuplicatePolicyError)) {
            throw error;
          }
          // Lost the race to another writer of the same triple: the
          // winner's row is the grant, exactly as if it had been found
          // above. A winner that cannot be read back means the refusal
          // was not a race — propagate it.
          const winner = await findByTriple(spec);
          if (winner === undefined) {
            throw error;
          }
          policy = winner;
          duplicate = true;
        }
      }
      if (duplicate) {
        logger.debug(
          "iam policy already held",
          fieldsOf(policy.metadata?.id ?? "", spec),
        );
      }
      // Deliberately unconditional (cloud#425): a duplicate re-grant is the
      // inline heal for a row whose tuple never landed.
      await lifecycle?.onPolicyGranted?.({ policy, duplicate });
      // The same unconditional heal for the affiliation the row stands for.
      const affiliation = affiliationOf(spec);
      if (affiliation !== undefined) {
        await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
      }
      return { policy, duplicate };
    },

    async revokeBySpec(spec): Promise<IamPolicy | undefined> {
      requireWellFormedTriple(spec);
      const existing = await findByTriple(spec);
      if (existing === undefined) {
        // No row: a composition still deletes the bare tuple (one written
        // before the row mirror existed); converges the store either way.
        await lifecycle?.onPolicyRevoked?.({ spec, policy: undefined });
        const affiliation = affiliationOf(spec);
        if (affiliation !== undefined) {
          // Nothing was deleted; re-deriving from the rows heals a tuple
          // that outlived them.
          await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
        }
      } else {
        await revokeRow(existing);
      }
      const { principal, resource } = refsOf(spec);
      if (
        principal.kind === ACCOUNT_KIND &&
        resource.kind === ORGANIZATION_KIND &&
        !(await holdsOrganizationRow(principal.id, resource.id))
      ) {
        await sweepOrganization(principal.id, resource.id);
      }
      return existing;
    },

    async cleanupResource(ref): Promise<void> {
      const asPrincipal = await policies.findByPrincipal(ref.kind, ref.id);
      const asResource = await policies.findByResource(ref.kind, ref.id);
      const isOwner = (policy: IamPolicy): boolean =>
        policy.spec?.relation === OWNER_RELATION;
      for (const policy of distinctById([
        ...asPrincipal,
        ...asResource.filter((policy) => !isOwner(policy)),
        ...asResource.filter(isOwner),
      ])) {
        await revokeRow(policy);
      }
    },

    async revokeOrgAccess(identityAccountId, organizationId): Promise<void> {
      const direct = await policies.findByPrincipalAndResource(
        kindEnumName(ApiResourceKind.identity_account),
        identityAccountId,
        kindEnumName(ApiResourceKind.organization),
        organizationId,
      );
      for (const policy of direct) {
        await revokeRow(policy);
      }
      await sweepOrganization(identityAccountId, organizationId);
    },
  };
}

/** The row for a fresh grant: the contract's identity strings, the derived id, the caller's stamp. */
function buildRow(spec: IamPolicySpec, caller: CallerIdentity): IamPolicy {
  const policy = create(IamPolicySchema, {
    apiVersion: IAM_POLICY_API_VERSION,
    kind: IAM_POLICY_KIND,
    metadata: create(ApiResourceMetadataSchema, { id: policyIdFor(spec) }),
    spec,
  });
  setAuditFieldsForCreate(IamPolicySchema, policy, caller);
  return policy;
}

/** One row per id, at its first position. */
function distinctById(
  policies: ReadonlyArray<IamPolicy>,
): ReadonlyArray<IamPolicy> {
  const seen = new Set<string>();
  return policies.filter((policy) => {
    const id = policy.metadata?.id ?? "";
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/** The structured fields every log line carries — ids and kinds, never a token. */
function fieldsOf(id: string, spec: IamPolicySpec): Record<string, string> {
  return {
    policyId: id,
    relation: spec.relation,
    principalKind: spec.principal?.kind ?? "",
    principalId: spec.principal?.id ?? "",
    resourceKind: spec.resource?.kind ?? "",
    resourceId: spec.resource?.id ?? "",
  };
}

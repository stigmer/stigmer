/**
 * The ONE grant and revoke path of the Grant domain, moved from the
 * cloud's former iam/grant/service.ts into open source so every edition writes and
 * deletes a grant row the same way. Its callers: the Grant command
 * controller (user grants and the three system RPCs), the built-in role
 * lifecycle (the organization creator's `owner` row; cleanup on delete)
 * and the membership rules (first-sign-in roles). Nothing else builds,
 * saves or deletes a grant row; a composition reaches this path as
 * in-process RPCs, never through an exported constructor.
 *
 * The two ordering invariants live here, nowhere else:
 *   CREATE: row before tuple — a crash between the two leaves
 *     row-without-tuple (granted on paper, denied in practice), healed by
 *     the caller's natural retry (the tuple write deliberately runs on
 *     duplicates too — the inline heal) or the boot backfill.
 *   DELETE: tuple before row — a crash leaves row+tuple (revoke failed,
 *     retry works); the reverse order was the fail-open incident class
 *     ("revoke access" silently becoming "keep access forever").
 * "Tuple" here is whatever the composed ResourceAuthorizationLifecycle does
 * in `onGranted` and `onRevoked`; with none composed, or one
 * without the two optional hooks, the path writes rows and notifies
 * nothing (the OSS posture: rows are the record).
 *
 * The row for a triple is found BY TRIPLE, never by derived id. Open
 * source's rows carry the derived id (constants.ts grantIdFor), so the
 * two lookups would agree here; the cloud's Java-era rows carry random
 * `iamp_<ulid>` ids and must revoke and deduplicate through this same
 * code, so `findByTriple` (the pair's rows filtered by relation) is the
 * one definition of "the row for this triple" and `findById` serves the
 * `get` RPC alone. On the OSS adapter that read is one scan of the kind
 * (resource-store.ts).
 *
 * The path is the one writer, so it refuses before it writes: before any
 * read, write or hook, `grant` and
 * `revokeBySpec` run the domain's wire refusals (wire-refusals.ts — a spec
 * whose resource or principal kind is not an ApiResourceKind member name,
 * or whose fields hold a canonical-text delimiter, is INVALID_ARGUMENT
 * with the pinned copy; that module is the one home of the rule the
 * controller and the ValidateGrantableRole step share). The
 * controller refuses the same kinds BEFORE position 1, so a wire
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
 * sweep finds nothing to do. After the rows, the sweep hands the departure
 * to the composition's `departures` handler (departure.ts: the person's My
 * vault in that organization is deleted, its sealed values destroyed), in
 * every edition. A failure there fails the revoke after the role is gone,
 * as a failed row revoke does: the person reaches nothing either way, and a
 * retry of the same revoke sweeps again and converges.
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
 * Who and why. Every method takes the caller, and the grants take the door
 * they came through (change.ts `GrantChangeCause`); the revokes know
 * theirs. For every access row it writes or deletes, the path hands the
 * store a change record (the actor, the cause, the row's organization), so
 * an edition that keeps a permission history writes it in the same atomic
 * unit as the row (store.ts). The organization is resolved before any row
 * of the operation is deleted: `cleanupResource` removes a resource's
 * scope link before its owner rows, and the sweep already knows its
 * organization. A row on another resource is resolved when it is revoked,
 * through that resource's scope links; when an earlier delete already
 * removed them (an organization's delete removes every link that names
 * it, and keeps the resources), the stored row of the highest level the
 * walk still reaches names the organization, the same `metadata.org` the
 * links were written from (stigmer#1603). The grant and revoke log lines
 * carry the same facts, open source's own trail.
 *
 * The row this path builds: the proto's apiVersion const and kind, the
 * derived id, the spec as given, and the caller's audit stamp through the
 * platform's one stamper (setAuditFieldsForCreate) — the cloud's
 * `buildNewPolicy` stamped neither org nor creator; this path stamps the
 * creator and, like the cloud, no `metadata.org`, because a grant may
 * span organizations and none owns it.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Grant } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  ApiResourceRef,
  GrantSpec,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

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
  GRANT_API_VERSION,
  GRANT_KIND,
  grantIdFor,
} from "./constants.js";
import { resolveHierarchy } from "./access-lists.js";
import { grantsAccess, grantActorOf } from "./change.js";
import type {
  GrantActor,
  GrantChangeCause,
  GrantChangeRecord,
} from "./change.js";
import { DuplicateGrantError } from "./store.js";
import type { GrantStore } from "./store.js";
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
  spec: GrantSpec,
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
  readonly grant: Grant;
  /** True when the triple was already held: no row was written, the hook still fired. */
  readonly duplicate: boolean;
}

export interface GrantPath {
  /**
   * Grant the triple as `caller`, through the door `cause` names: gate,
   * find by triple, write the row when absent (the caller's audit stamp),
   * then `onGranted` — on the duplicate arm too. A hook throw fails
   * the grant with the row in place.
   */
  grant(
    spec: GrantSpec,
    caller: CallerIdentity,
    cause: GrantChangeCause,
  ): Promise<GrantResult>;
  /**
   * Revoke the triple as `caller` (Grant.delete's door): gate, find by
   * triple, `onRevoked` (with the row, or with the spec alone on the
   * absent arm), then delete the row. A hook throw leaves row and tuple.
   * Answers the revoked row, or `undefined` when there was none.
   */
  revokeBySpec(
    spec: GrantSpec,
    caller: CallerIdentity,
  ): Promise<Grant | undefined>;
  /**
   * Revoke every row naming the ref as its principal, then every row naming
   * it as its resource with the `owner` rows last, each through the revoke
   * order; a row that is both is revoked once. Nothing to clean is a no-op.
   * The order matters where the ref still exists: an organization's delete
   * runs this before its row goes and fails on the first fault, so a
   * cleanup that stops partway has not yet removed the owners who may
   * retry it. `caller` is whoever deleted the resource.
   */
  cleanupResource(ref: ApiResourceRef, caller: CallerIdentity): Promise<void>;
  /**
   * Revoke every relation the account holds directly on the organization,
   * then every row it holds on the organization's resources except its
   * authorship (the module header's sweep), as `caller`.
   */
  revokeOrgAccess(
    identityAccountId: string,
    organizationId: string,
    caller: CallerIdentity,
  ): Promise<void>;
}

/**
 * What the path reads from a stored resource's own row, the two facts it
 * needs from outside the grant rows: who created it (the removal sweep
 * keeps authorship), and which organization it belongs to (a change record
 * whose scope links a delete already removed).
 */
export interface StoredResources {
  /**
   * The row's `status.audit.spec_audit.created_by.id`, or undefined when
   * this server stores no row of that kind and id.
   */
  creatorOf(kind: string, id: string): Promise<string | undefined>;
  /**
   * The row's `metadata.org`, or "" when this server stores no row of that
   * kind and id (a kind a composition keeps in its own table, or a row
   * already deleted).
   */
  organizationOf(kind: string, id: string): Promise<string>;
}

/**
 * What the composition does when a person leaves an organization, after
 * the sweep has revoked their rows: called with the account, the
 * organization and the caller who revoked. Idempotent: a retry calls it
 * again.
 */
export type OrganizationDepartureHandler = (
  identityAccountId: string,
  organizationId: string,
  caller: CallerIdentity,
) => Promise<void>;

export interface GrantPathDeps {
  readonly grants: GrantStore;
  readonly resources: StoredResources;
  /** The composition's departure handler (departure.ts); undefined does nothing more than the sweep. */
  readonly departures?: OrganizationDepartureHandler;
  /** The composed driver, if any; a driver without the two grant hooks is the same as none. */
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

/** Who made a change and through which door; the organization is resolved per row. */
interface Change {
  readonly actor: GrantActor;
  readonly cause: GrantChangeCause;
}

/** How a row's organization is found: `organizationOfResource`, or a value its operation already knows. */
type OrganizationOf = (resource: ApiResourceRef) => Promise<string>;

export function newGrantPath(
  deps: GrantPathDeps,
): GrantPath {
  const { grants: grants, resources, lifecycle, logger, departures } = deps;

  /**
   * The organization a resource belongs to: through its scope links, or,
   * when the walk reaches no organization (a delete already removed the
   * link), the `metadata.org` of the stored row at the walk's last level,
   * the resource itself or the parent it inherits from (a run's session).
   * "" when neither names one.
   */
  async function organizationOfResource(
    resource: ApiResourceRef,
  ): Promise<string> {
    if (resource.kind === ORGANIZATION_KIND) {
      return resource.id;
    }
    const hierarchy = await resolveHierarchy(
      grants,
      resource.kind,
      resource.id,
      true,
    );
    const linked = hierarchy.find((level) => level.kind === ORGANIZATION_KIND);
    if (linked !== undefined) {
      return linked.id;
    }
    const top = hierarchy[hierarchy.length - 1] ?? resource;
    return resources.organizationOf(top.kind, top.id);
  }

  /** The record the store keeps beside an access row; none for a structural link. */
  async function recordFor(
    spec: GrantSpec,
    change: Change,
    organizationOf: OrganizationOf,
  ): Promise<GrantChangeRecord | undefined> {
    if (spec.resource === undefined || !grantsAccess(spec)) {
      return undefined;
    }
    return {
      actor: change.actor,
      cause: change.cause,
      organizationId: await organizationOf(spec.resource),
    };
  }

  /** The row holding this exact triple — the pair's rows, filtered by relation. */
  async function findByTriple(
    spec: GrantSpec,
  ): Promise<Grant | undefined> {
    const { principal, resource } = refsOf(spec);
    const onPair = await grants.findByPrincipalAndResource(
      principal.kind,
      principal.id,
      resource.kind,
      resource.id,
    );
    return onPair.find(
      (grant) =>
        grant.spec !== undefined &&
        grant.spec.relation === spec.relation &&
        grant.spec.principal?.relation === principal.relation,
    );
  }

  /** The revoke order for one row: its record resolved, the hook, then the delete. */
  async function revokeRow(
    grant: Grant,
    change: Change,
    organizationOf: OrganizationOf = organizationOfResource,
  ): Promise<void> {
    const spec = grant.spec;
    if (spec === undefined) {
      throw new Error(
        `grant ${grant.metadata?.id ?? "?"} has no spec — corrupt row`,
      );
    }
    const record = await recordFor(spec, change, organizationOf);
    const affiliation = affiliationOf(spec);
    if (affiliation !== undefined) {
      await lifecycle?.onOrganizationAffiliationChanging?.(affiliation);
    }
    await lifecycle?.onRevoked?.({ spec, grant: grant });
    const id = grant.metadata?.id ?? "";
    await grants.deleteById(id, record);
    logger.info("grant revoked", fieldsOf(id, spec, change, record));
    if (affiliation !== undefined) {
      await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
    }
  }

  /** Whether the account still holds any row on the organization. */
  async function holdsOrganizationRow(
    accountId: string,
    organizationId: string,
  ): Promise<boolean> {
    const held = await grants.findByPrincipal(ACCOUNT_KIND, accountId);
    return held.some(
      (grant) =>
        grant.spec?.resource?.kind === ORGANIZATION_KIND &&
        grant.spec.resource.id === organizationId,
    );
  }

  /** Whether the row records the resource's creator as its author. */
  async function isAuthorship(
    grant: Grant,
    accountId: string,
  ): Promise<boolean> {
    const spec = grant.spec;
    if (
      spec?.resource === undefined ||
      !AUTHORSHIP_RELATIONS.has(spec.relation)
    ) {
      return false;
    }
    const creator = await resources.creatorOf(
      spec.resource.kind,
      spec.resource.id,
    );
    return creator === accountId;
  }

  /** Revoke what the account holds on the organization's resources, authorship kept. */
  async function sweepOrganization(
    accountId: string,
    organizationId: string,
    caller: CallerIdentity,
  ): Promise<void> {
    const actor = grantActorOf(caller);
    const change: Change = { actor, cause: "left_organization" };
    const inThisOrganization: OrganizationOf = async () => organizationId;
    const held = await grants.findByPrincipal(ACCOUNT_KIND, accountId);
    let revoked = 0;
    for (const grant of held) {
      const resource = grant.spec?.resource;
      if (resource === undefined || resource.kind === ORGANIZATION_KIND) {
        continue;
      }
      const hierarchy = await resolveHierarchy(
        grants,
        resource.kind,
        resource.id,
        true,
      );
      const inOrganization = hierarchy.some(
        (level) =>
          level.kind === ORGANIZATION_KIND && level.id === organizationId,
      );
      if (!inOrganization || (await isAuthorship(grant, accountId))) {
        continue;
      }
      await revokeRow(grant, change, inThisOrganization);
      revoked++;
    }
    if (revoked > 0) {
      logger.info("organization access swept", {
        identityAccountId: accountId,
        organizationId,
        revoked: String(revoked),
      });
    }
    await departures?.(accountId, organizationId, caller);
  }

  return {
    async grant(spec, caller, cause): Promise<GrantResult> {
      requireWellFormedTriple(spec);
      const change: Change = { actor: grantActorOf(caller), cause };
      if (
        spec.relation === AFFILIATED_RELATION &&
        spec.resource?.kind === ORGANIZATION_KIND
      ) {
        throw new ConnectError(
          AFFILIATION_NOT_GRANTABLE_MESSAGE,
          Code.InvalidArgument,
        );
      }
      let grant = await findByTriple(spec);
      let duplicate = grant !== undefined;
      if (grant === undefined) {
        const fresh = buildRow(spec, caller);
        const record = await recordFor(spec, change, organizationOfResource);
        try {
          await grants.save(fresh, record);
          grant = fresh;
          logger.info(
            "grant created",
            fieldsOf(grantIdFor(spec), spec, change, record),
          );
        } catch (error) {
          if (!(error instanceof DuplicateGrantError)) {
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
          grant = winner;
          duplicate = true;
        }
      }
      if (duplicate) {
        logger.debug(
          "grant already held",
          fieldsOf(grant.metadata?.id ?? "", spec, change, undefined),
        );
      }
      // Deliberately unconditional: a duplicate re-grant is the
      // inline heal for a row whose tuple never landed.
      await lifecycle?.onGranted?.({ grant: grant, duplicate });
      // The same unconditional heal for the affiliation the row stands for.
      const affiliation = affiliationOf(spec);
      if (affiliation !== undefined) {
        await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
      }
      return { grant: grant, duplicate };
    },

    async revokeBySpec(spec, caller): Promise<Grant | undefined> {
      requireWellFormedTriple(spec);
      const actor = grantActorOf(caller);
      const existing = await findByTriple(spec);
      if (existing === undefined) {
        // No row: a composition still deletes the bare tuple (one written
        // before the row mirror existed); converges the store either way.
        await lifecycle?.onRevoked?.({ spec, grant: undefined });
        const affiliation = affiliationOf(spec);
        if (affiliation !== undefined) {
          // Nothing was deleted; re-deriving from the rows heals a tuple
          // that outlived them.
          await lifecycle?.onOrganizationAffiliationChanged?.(affiliation);
        }
      } else {
        await revokeRow(existing, { actor, cause: "revoke" });
      }
      const { principal, resource } = refsOf(spec);
      if (
        principal.kind === ACCOUNT_KIND &&
        resource.kind === ORGANIZATION_KIND &&
        !(await holdsOrganizationRow(principal.id, resource.id))
      ) {
        await sweepOrganization(principal.id, resource.id, caller);
      }
      return existing;
    },

    async cleanupResource(ref, caller): Promise<void> {
      const change: Change = {
        actor: grantActorOf(caller),
        cause: "resource_deleted",
      };
      const asPrincipal = await grants.findByPrincipal(ref.kind, ref.id);
      const asResource = await grants.findByResource(ref.kind, ref.id);
      // The ref's own scope link is one of its resource-side rows and goes
      // before its owners, so its organization is read once, up front.
      const refOrganization = asResource.some(
        (grant) => grant.spec !== undefined && grantsAccess(grant.spec),
      )
        ? await organizationOfResource(ref)
        : "";
      const organizationOf: OrganizationOf = async (resource) =>
        resource.kind === ref.kind && resource.id === ref.id
          ? refOrganization
          : organizationOfResource(resource);
      const isOwner = (grant: Grant): boolean =>
        grant.spec?.relation === OWNER_RELATION;
      for (const grant of distinctById([
        ...asPrincipal,
        ...asResource.filter((row) => !isOwner(row)),
        ...asResource.filter(isOwner),
      ])) {
        await revokeRow(grant, change, organizationOf);
      }
    },

    async revokeOrgAccess(
      identityAccountId,
      organizationId,
      caller,
    ): Promise<void> {
      const actor = grantActorOf(caller);
      const change: Change = { actor, cause: "organization_access_revoked" };
      const direct = await grants.findByPrincipalAndResource(
        kindEnumName(ApiResourceKind.identity_account),
        identityAccountId,
        kindEnumName(ApiResourceKind.organization),
        organizationId,
      );
      for (const grant of direct) {
        await revokeRow(grant, change);
      }
      await sweepOrganization(identityAccountId, organizationId, caller);
    },
  };
}

/** The row for a fresh grant: the contract's identity strings, the derived id, the caller's stamp. */
function buildRow(spec: GrantSpec, caller: CallerIdentity): Grant {
  const grant = create(GrantSchema, {
    apiVersion: GRANT_API_VERSION,
    kind: GRANT_KIND,
    metadata: create(ApiResourceMetadataSchema, { id: grantIdFor(spec) }),
    spec,
  });
  setAuditFieldsForCreate(GrantSchema, grant, caller);
  return grant;
}

/** One row per id, at its first position. */
function distinctById(
  grants: ReadonlyArray<Grant>,
): ReadonlyArray<Grant> {
  const seen = new Set<string>();
  return grants.filter((grant) => {
    const id = grant.metadata?.id ?? "";
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * The structured fields every log line carries — ids, kinds, who and why,
 * never a token; the organization when the row is an access row.
 */
function fieldsOf(
  id: string,
  spec: GrantSpec,
  change: Change,
  record: GrantChangeRecord | undefined,
): Record<string, string> {
  return {
    grantId: id,
    relation: spec.relation,
    principalKind: spec.principal?.kind ?? "",
    principalId: spec.principal?.id ?? "",
    resourceKind: spec.resource?.kind ?? "",
    resourceId: spec.resource?.id ?? "",
    actorId: change.actor.id,
    actorClass: change.actor.callerClass,
    cause: change.cause,
    ...(record === undefined ? {} : { organizationId: record.organizationId }),
  };
}

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
 * The path is the one writer, so it is the one gate (Q-S2-1; slice 1
 * ruling 2): before any read, write or hook, `grant` and `revokeBySpec`
 * refuse a spec whose resource or principal kind is not an ApiResourceKind
 * member name, or whose fields hold a canonical-text delimiter —
 * INVALID_ARGUMENT with the pinned copy. Under an enforcing Authorizer the
 * chain's position 1 already denied the unknown kind; under the permissive
 * one this is what keeps a garbage row out of the store and a garbage spec
 * away from a composition's tuple delete. `cleanupResource` and
 * `revokeOrgAccess` take refs and ids their callers read from rows, so they
 * do not gate.
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
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { kindByEnumName } from "../../pipeline/apiresource-meta.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  malformedTripleField,
  malformedTripleMessage,
  policyIdFor,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "./constants.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";

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
   * Revoke every row naming the ref as its resource, then every row naming
   * it as its principal, each through the revoke order; a row that is both
   * is revoked once. Nothing to clean is a no-op.
   */
  cleanupResource(ref: ApiResourceRef): Promise<void>;
  /** Revoke every relation the account holds directly on the organization. */
  revokeOrgAccess(
    identityAccountId: string,
    organizationId: string,
  ): Promise<void>;
}

export interface IamPolicyGrantPathDeps {
  readonly policies: IamPolicyStore;
  /** The composed driver, if any; a driver without the two policy hooks is the same as none. */
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

export function newIamPolicyGrantPath(
  deps: IamPolicyGrantPathDeps,
): IamPolicyGrantPath {
  const { policies, lifecycle, logger } = deps;

  /** The row holding this exact triple — the pair's rows, filtered by relation. */
  async function findByTriple(
    spec: IamPolicySpec,
  ): Promise<IamPolicy | undefined> {
    const { principal, resource } = admittedRefs(spec);
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
    await lifecycle?.onPolicyRevoked?.({ spec, policy });
    const id = policy.metadata?.id ?? "";
    await policies.deleteById(id);
    logger.info("iam policy revoked", fieldsOf(id, spec));
  }

  return {
    async grant(spec, caller): Promise<GrantResult> {
      admittedTriple(spec);
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
      return { policy, duplicate };
    },

    async revokeBySpec(spec): Promise<IamPolicy | undefined> {
      admittedTriple(spec);
      const existing = await findByTriple(spec);
      if (existing === undefined) {
        // No row: a composition still deletes the bare tuple (one written
        // before the row mirror existed); converges the store either way.
        await lifecycle?.onPolicyRevoked?.({ spec, policy: undefined });
        return undefined;
      }
      await revokeRow(existing);
      return existing;
    },

    async cleanupResource(ref): Promise<void> {
      const asResource = await policies.findByResource(ref.kind, ref.id);
      const asPrincipal = await policies.findByPrincipal(ref.kind, ref.id);
      for (const policy of distinctById([...asResource, ...asPrincipal])) {
        await revokeRow(policy);
      }
    },

    async revokeOrgAccess(identityAccountId, organizationId): Promise<void> {
      const direct = await policies.findByPrincipalAndResource(
        "identity_account",
        identityAccountId,
        "organization",
        organizationId,
      );
      for (const policy of direct) {
        await revokeRow(policy);
      }
    },
  };
}

/** Both refs, present — the gate has run or the spec came from a stored row. */
function admittedRefs(spec: IamPolicySpec): {
  principal: ApiResourceRef;
  resource: ApiResourceRef;
} {
  if (spec.principal === undefined || spec.resource === undefined) {
    throw new Error("policy spec must carry principal and resource");
  }
  return { principal: spec.principal, resource: spec.resource };
}

/**
 * The gate every spec-taking writer runs first: refs present, no
 * delimiter in any field, both kinds enum member names — the resource kind
 * read first, the cloud's order. INVALID_ARGUMENT with the pinned copy.
 */
function admittedTriple(spec: IamPolicySpec): void {
  const { principal, resource } = admittedRefs(spec);
  const malformed = malformedTripleField(spec);
  if (malformed !== undefined) {
    throw new ConnectError(
      malformedTripleMessage(malformed),
      Code.InvalidArgument,
    );
  }
  if (
    kindByEnumName(resource.kind) === ApiResourceKind.api_resource_kind_unknown
  ) {
    throw new ConnectError(
      unknownResourceKindMessage(resource.kind),
      Code.InvalidArgument,
    );
  }
  if (
    kindByEnumName(principal.kind) === ApiResourceKind.api_resource_kind_unknown
  ) {
    throw new ConnectError(
      unknownPrincipalKindMessage(principal.kind),
      Code.InvalidArgument,
    );
  }
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

/**
 * Organization domain steps — port
 * pkg/domain/organization/controller/steps.go.
 *
 * Organization is the single resource whose id equals its slug. Every
 * other kind mints a prefixed ULID (agt_…, wfl_…) in the shared
 * BuildNewState; Organization deliberately deviates because it is the
 * immutable, globally unique tenancy root every child resource references
 * by slug (metadata.org). These two steps implement that deviation and its
 * uniqueness guarantee, mirroring cloud's OrganizationCreateHandler
 * (CheckDuplicate + CopySlugToId) step-for-step.
 *
 * The same deviation shapes the delete. A slug is never taken twice
 * (slug-ledger.ts), and newRevokeOrganizationPoliciesStep still revokes
 * the organization's policy rows BEFORE its row is deleted, and fails the
 * delete when it cannot, so nothing that grants on the organization
 * outlives it.
 *
 * Proven by organization.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/organization.test.ts and __tests__/organization-delete.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { alreadyExistsError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { refusalForHeldSlug } from "./slug-ledger.js";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/**
 * Rejects a create when an organization already exists with the same slug,
 * checked GLOBALLY by id.
 *
 * Organizations use their slug as their id (see newCopySlugToIdStep), so
 * slug uniqueness must be global — not org-scoped like every other
 * resource. The generic CheckDuplicate scopes its lookup by metadata.org,
 * which is only safe for organizations because callers leave it empty; a
 * direct API caller that set a non-empty metadata.org could otherwise slip
 * a colliding slug past the scoped check and, because the store persists
 * by id with upsert semantics, silently overwrite the existing
 * organization. Checking existence by id (== the resolved slug) closes
 * that hole and mirrors cloud's OrganizationCreateHandler.CheckDuplicate.
 *
 * A slug is taken for good (slug-ledger.ts), so the slug ledger is read
 * first: a retired slug is refused with the reserved reason, a held one
 * with the duplicate copy. The row is read after it for an organization no
 * ledger entry records yet, one an older binary created during a rolling
 * upgrade. This read is the early refusal, before any gate; the atomic
 * guarantee is ClaimOrganizationSlug's, immediately before Persist.
 *
 * Runs after ResolveSlug (slug is set) and before BuildNewState/
 * CopySlugToId (the id is not yet minted), so it keys on the slug value
 * that will become the id.
 */
export function newCheckOrgDuplicateStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    // The shared vocabulary name — the inventory row reads straight onto
    // the chain even though the semantics are organization-specific.
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("organization metadata is nil"), "duplicate check");
      }
      // ResolveSlug runs before this step, so an empty slug here is a
      // server-side pipeline-ordering bug, not bad client input.
      if (metadata.slug === "") {
        throw internalError(new Error("organization slug is empty"), "duplicate check");
      }

      let entry;
      try {
        entry = await store.organizationSlugs.find(metadata.slug);
      } catch (error) {
        throw internalError(error, "failed to check for duplicate organization");
      }
      if (entry !== undefined) {
        throw refusalForHeldSlug(entry);
      }

      try {
        await store.getResource(
          ctx.apiResourceKind,
          metadata.slug,
          OrganizationSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return; // no holder — the create may proceed
        }
        throw internalError(error, "failed to check for duplicate organization");
      }
      throw alreadyExistsError("Organization", `slug '${metadata.slug}'`);
    },
  };
}

/**
 * Sets metadata.id to metadata.slug — the deliberate id == slug exception
 * for the tenancy root. Runs after BuildNewState (which mints a throwaway
 * org_<ulid>) and overwrites that id with the slug, exactly mirroring
 * cloud's OrganizationCreateHandler.CopySlugToId.
 */
export function newCopySlugToIdStep(): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "CopySlugToId",
    execute(ctx: RequestContext<typeof OrganizationSchema>): void {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("organization metadata is nil"), "copy slug to id");
      }
      // ResolveSlug guarantees a non-empty slug upstream; an empty slug
      // here is a pipeline-ordering bug, not bad client input.
      if (metadata.slug === "") {
        throw internalError(new Error("organization slug is empty"), "copy slug to id");
      }
      metadata.id = metadata.slug;
    },
  };
}

/**
 * Revokes every policy row that names the organization, as principal or as
 * resource, before the delete removes its row: the rows its members hold
 * on it, and the scope link every organization-scoped resource holds to
 * it. Runs after the `org-delete:pre-delete` slot and before
 * DeleteResource.
 *
 * The generic delete chains clean up after the row and log a fault,
 * because a deleted resource's rows grant nothing once it is gone. An
 * organization is the exception: its rows are the grants on the tenancy
 * root itself, and the scope link of every resource under it. The slug is
 * never taken again (slug-ledger.ts), so they cannot pass to a new holder,
 * but a row left behind would still be a grant nobody administers. So this
 * step does not catch. A fault fails the delete with the
 * organization in place, and a retry resumes where the revocation stopped
 * (the grant path revokes the organization's owners last, so the owner
 * who retries still can). The grant path fires the composed driver's
 * `onPolicyRevoked` before each row, so a composition's tuples go with
 * their rows. The post-delete CleanupIamPolicies still runs: it catches
 * whatever a concurrent write named the organization with in between.
 */
export function newRevokeOrganizationPoliciesStep<Desc extends DescMessage>(
  grantPath: IamPolicyGrantPath,
): PipelineStep<Desc> {
  return {
    name: "RevokeOrganizationPolicies",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error("organization delete reached RevokeOrganizationPolicies without its loaded row"),
          "failed to remove the organization's access policies",
        );
      }
      try {
        await grantPath.cleanupResource(
          create(ApiResourceRefSchema, {
            kind: ApiResourceKind[ApiResourceKind.organization],
            id,
          }),
          ctx.callerIdentity,
        );
      } catch (error) {
        throw internalError(
          error,
          "failed to remove the organization's access policies",
        );
      }
    },
  };
}

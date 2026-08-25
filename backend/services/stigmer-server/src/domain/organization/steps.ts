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
 * Proven by organization.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/organization.test.ts.
 */
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { alreadyExistsError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";

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

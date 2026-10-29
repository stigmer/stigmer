/**
 * LoadForApply: Apply's existence probe:
 * NEVER fails on not-found — it sets the ShouldCreate/ExistsInDatabase
 * flags the controller branches on (create vs update), and populates the
 * id when the resource exists. The resource is found as every write finds
 * it (names.ts findResourceForWrite): by the id the manifest carries, in
 * its organization, then by slug; a slug the resource was renamed away
 * from is refused with SLUG_RENAMED rather than updating it for the hold
 * and making a second one after.
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Store } from "../../store/interface.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceForWrite, storedRowReader } from "./names.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/** Context keys the controller branches on. */
export const EXISTS_IN_DATABASE_KEY = "existsInDatabase";
export const SHOULD_CREATE_KEY = "shouldCreate";

export function newLoadForApplyStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "LoadForApply",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      // No metadata or no slug (ResolveSlug should have run) → create.
      if (metadata === undefined || metadata.slug === "") {
        ctx.set(EXISTS_IN_DATABASE_KEY, false);
        ctx.set(SHOULD_CREATE_KEY, true);
        return;
      }

      const existing = await findResourceForWrite(
        store,
        ctx.apiResourceKind,
        metadata,
        storedRowReader(store, ctx.apiResourceKind, ctx.schema),
      );

      if (existing === undefined) {
        ctx.set(EXISTS_IN_DATABASE_KEY, false);
        ctx.set(SHOULD_CREATE_KEY, true);
        return;
      }

      ctx.set(EXISTING_RESOURCE_KEY, existing);
      ctx.set(EXISTS_IN_DATABASE_KEY, true);
      ctx.set(SHOULD_CREATE_KEY, false);
      metadata.id = metadataOf(existing)?.id ?? "";
    },
  };
}

/**
 * The apply update-arm delegation message: the ORIGINAL request (never
 * the pipeline's mutated clone) with ONLY the resolved id
 * copied on. Apply requests identify by name+org, not id, so without
 * this the delegated update chain's Authorize step checks an EMPTY
 * resource id — the permissive OSS default would not notice, but an
 * enforcing Authorizer must check the true target. The resolved id
 * replaces whatever id the manifest carried: one the probe passed over (a
 * row of another organization, or none) must not reach the update chain,
 * which loads by id.
 */
export function withResolvedApplyId<Desc extends DescMessage>(
  schema: Desc,
  original: MessageShape<Desc>,
  resolved: RequestContext<Desc>,
): MessageShape<Desc> {
  const enriched = clone(schema, original);
  const metadata = metadataOf(enriched);
  const resolvedId = metadataOf(resolved.newState)?.id ?? "";
  if (metadata !== undefined && resolvedId !== "") {
    metadata.id = resolvedId;
  }
  return enriched;
}

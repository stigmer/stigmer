/**
 * LoadForApply — ports steps/load_for_apply.go. Apply's existence probe:
 * NEVER fails on not-found — it sets the ShouldCreate/ExistsInDatabase
 * flags the controller branches on (create vs update), and populates the
 * id when the resource exists.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Store } from "../../store/interface.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceBySlug } from "./helpers.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/** Context keys (Go ExistsInDatabaseKey / ShouldCreateKey). */
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

      const existing = await findResourceBySlug(
        store,
        ctx.apiResourceKind,
        ctx.schema,
        metadata.slug,
        metadata.org,
      );

      if (existing === undefined) {
        ctx.set(EXISTS_IN_DATABASE_KEY, false);
        ctx.set(SHOULD_CREATE_KEY, true);
        return;
      }

      ctx.set(EXISTING_RESOURCE_KEY, existing);
      ctx.set(EXISTS_IN_DATABASE_KEY, true);
      ctx.set(SHOULD_CREATE_KEY, false);
      if (metadata.id === "") {
        metadata.id = metadataOf(existing)?.id ?? "";
      }
    },
  };
}

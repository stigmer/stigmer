/**
 * LoadExisting — ports steps/load_existing.go. Update/Delete's loader:
 * by id when provided (direct lookup), else by org-scoped slug (the
 * fallback populates the id back into metadata so merge/persist have it).
 * NotFound FAILS here — apply's tolerant probe is LoadForApply.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { internalError, invalidArgumentError, notFoundError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceBySlug } from "./helpers.js";
import { metadataOf } from "./shapes.js";

/** Context key for the loaded resource (Go ExistingResourceKey). */
export const EXISTING_RESOURCE_KEY = "existingResource";

export function newLoadExistingStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "LoadExisting",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "load existing");
      }

      let existing: MessageShape<Desc>;
      if (metadata.id !== "") {
        try {
          existing = await store.getResource(
            ctx.apiResourceKind,
            metadata.id,
            ctx.schema,
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError(getKindName(ctx.apiResourceKind), metadata.id);
          }
          throw error;
        }
      } else if (metadata.slug !== "") {
        const found = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          ctx.schema,
          metadata.slug,
          metadata.org,
        );
        if (found === undefined) {
          throw notFoundError(getKindName(ctx.apiResourceKind), metadata.slug);
        }
        existing = found;
        // Populate the id so merge and persist have it.
        metadata.id = metadataOf(existing)?.id ?? "";
      } else {
        throw invalidArgumentError("resource id or slug is required for update");
      }

      ctx.set(EXISTING_RESOURCE_KEY, existing);
    },
  };
}

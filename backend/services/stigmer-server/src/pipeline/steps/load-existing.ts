/**
 * LoadExisting — ports steps/load_existing.go. Update/Delete's loader:
 * by id when provided (direct lookup), else by org-scoped slug (the
 * fallback populates the id back into metadata so merge/persist have it).
 * A slug is read as every write reads one (names.ts findResourceForWrite):
 * one the resource was renamed away from is refused with SLUG_RENAMED.
 * NotFound FAILS here — apply's tolerant probe is LoadForApply.
 *
 * Deliberate divergence from the Go source (decided 2026-08-26): Go
 * mapped ANY store error to NotFound. Here only the typed
 * ResourceNotFoundError is NotFound; other store failures rethrow to the
 * executor's sanitized Internal (see pipeline.ts and load-target.ts —
 * the same narrowing, applied at every store-read site).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceForWrite, kindClaimsNames, storedRowReader } from "./names.js";
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
        throw internalError(
          new Error("resource metadata is nil"),
          "load existing",
        );
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
      } else if (metadata.slug !== "" && kindClaimsNames(ctx.apiResourceKind)) {
        const found = await findResourceForWrite(
          store,
          ctx.apiResourceKind,
          { id: "", org: metadata.org, slug: metadata.slug },
          storedRowReader(store, ctx.apiResourceKind, ctx.schema),
        );
        if (found === undefined) {
          throw notFoundError(getKindName(ctx.apiResourceKind), metadata.slug);
        }
        existing = found;
        // Populate the id so merge and persist have it.
        metadata.id = metadataOf(existing)?.id ?? "";
      } else if (metadata.slug !== "") {
        // A kind whose slugs are not names (pipeline/steps/names.ts
        // NAMED_KINDS) is addressed by id alone.
        throw invalidArgumentError(
          `resource id is required to update a ${getKindName(ctx.apiResourceKind)}`,
        );
      } else {
        throw invalidArgumentError(
          "resource id or slug is required for update",
        );
      }

      ctx.set(EXISTING_RESOURCE_KEY, existing);
    },
  };
}

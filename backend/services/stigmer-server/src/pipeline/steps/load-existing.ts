/**
 * LoadExisting — ports steps/load_existing.go. Update/Delete's loader:
 * by id when provided (direct lookup), else by org-scoped slug (the
 * fallback populates the id back into metadata so merge/persist have it).
 * A slug is read as every write reads one (names.ts findResourceForWrite):
 * one the resource was renamed away from is refused with SLUG_RENAMED.
 * NotFound FAILS here — apply's tolerant probe is LoadForApply.
 *
 * The row is read with its exact stored bytes, kept under
 * EXISTING_RESOURCE_BYTES_KEY: Persist swaps on them, so a write that
 * lands between this read and the chain's write is never undone
 * (pipeline/guarded-write.ts).
 *
 * Deliberate divergence from the Go source (decided 2026-08-26): Go
 * mapped ANY store error to NotFound. Here only the typed
 * ResourceNotFoundError is NotFound; other store failures rethrow to the
 * executor's sanitized Internal (see pipeline.ts and load-target.ts —
 * the same narrowing, applied at every store-read site).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { ResourceReadForWrite, Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceForWrite, kindClaimsNames } from "./names.js";
import { metadataOf } from "./shapes.js";

/** Context key for the loaded resource (Go ExistingResourceKey). */
export const EXISTING_RESOURCE_KEY = "existingResource";

/**
 * Context key for the loaded row's exact stored bytes, the guard of the
 * chain's compare-and-swap write (Persist).
 */
export const EXISTING_RESOURCE_BYTES_KEY = "existingResourceBytes";

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

      let read: ResourceReadForWrite<Desc>;
      if (metadata.id !== "") {
        const byId = await readForWrite(store, ctx, metadata.id);
        if (byId === undefined) {
          throw notFoundError(getKindName(ctx.apiResourceKind), metadata.id);
        }
        read = byId;
      } else if (metadata.slug !== "" && kindClaimsNames(ctx.apiResourceKind)) {
        // The bytes of each row the lookup read, kept for the one it answers.
        const reads = new Map<string, ResourceReadForWrite<Desc>>();
        const resource = await findResourceForWrite(
          store,
          ctx.apiResourceKind,
          { id: "", org: metadata.org, slug: metadata.slug },
          async (id) => {
            const read = await readForWrite(store, ctx, id);
            if (read !== undefined) {
              reads.set(id, read);
            }
            return read?.resource;
          },
        );
        const found =
          resource === undefined
            ? undefined
            : reads.get(metadataOf(resource)?.id ?? "");
        if (found === undefined) {
          throw notFoundError(getKindName(ctx.apiResourceKind), metadata.slug);
        }
        read = found;
        // Populate the id so merge and persist have it.
        metadata.id = metadataOf(read.resource)?.id ?? "";
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

      ctx.set(EXISTING_RESOURCE_KEY, read.resource);
      ctx.set(EXISTING_RESOURCE_BYTES_KEY, read.bytes);
    },
  };
}

/** The row by id with its stored bytes; undefined when there is none. */
async function readForWrite<Desc extends DescMessage>(
  store: Store,
  ctx: RequestContext<Desc>,
  id: string,
): Promise<ResourceReadForWrite<Desc> | undefined> {
  try {
    return await store.readResourceForWrite(ctx.apiResourceKind, id, ctx.schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

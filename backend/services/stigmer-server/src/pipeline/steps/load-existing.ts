/**
 * LoadExisting — ports steps/load_existing.go. An update's loader, by the
 * id the update names (AIP-134: an update names its target; finding by
 * slug is apply's, LoadForApply). An update without an id is refused with
 * INVALID_ARGUMENT, and NotFound FAILS here.
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
import { getKindName, kindNoun } from "../apiresource-meta.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
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

      if (metadata.id === "") {
        throw invalidArgumentError(
          `resource.metadata.id is required: an update names the ${kindNoun(ctx.apiResourceKind)} by its id`,
        );
      }
      const read = await readForWrite(store, ctx, metadata.id);
      if (read === undefined) {
        throw notFoundError(getKindName(ctx.apiResourceKind), metadata.id);
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

/**
 * IndexSearch / DeleteSearchIndex — port steps/index_search.go. Search
 * index maintenance is BEST-EFFORT by contract: the resource is already
 * persisted (or deleted) when these run, and the index can be rebuilt from
 * the resources table — a failure logs a warning and never fails the
 * pipeline. IndexSearch runs AFTER Persist; DeleteSearchIndex AFTER
 * DeleteResource.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";

import type { SearchIndexEntry, Store } from "../../store/interface.js";
import type { Logger } from "../../boot/logger.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { RESOURCE_ID_KEY } from "./delete.js";
import { internalError } from "../errors.js";
import { metadataOf } from "./shapes.js";

/**
 * Extracts the searchable fields from a resource — Go SearchIndexExtractor.
 * Each indexed domain registers its own extractor (undefined entry = skip).
 */
export interface SearchIndexExtractor {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined;
}

export function newIndexSearchStep<Desc extends DescMessage>(
  store: Store,
  extractor: SearchIndexExtractor,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "IndexSearch",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const resource = ctx.newState;
      const metadata = metadataOf(resource);
      if (metadata === undefined || metadata.id === "") {
        logger.warn("IndexSearch: resource has no metadata or ID, skipping indexing");
        return;
      }

      const entry = extractor.getSearchIndexEntry(resource);
      if (entry === undefined) {
        logger.warn("IndexSearch: extractor returned no entry, skipping indexing", {
          id: metadata.id,
        });
        return;
      }

      try {
        await store.upsertSearchIndex(ctx.apiResourceKind, metadata.id, entry);
      } catch (error) {
        logger.warn("IndexSearch: failed to update search index (best-effort)", {
          id: metadata.id,
          kind: apiResourceKindName(ctx.apiResourceKind),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function newDeleteSearchIndexStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "DeleteSearchIndex",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = ctx.get(RESOURCE_ID_KEY);
      if (typeof id !== "string" || id === "") {
        throw internalError(
          new Error("resource id not found in context (ExtractResourceId must run first)"),
          "delete search index ordering",
        );
      }
      try {
        await store.deleteSearchIndex(ctx.apiResourceKind, id);
      } catch (error) {
        logger.warn("DeleteSearchIndex: failed to remove search index entry (best-effort)", {
          id,
          kind: apiResourceKindName(ctx.apiResourceKind),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

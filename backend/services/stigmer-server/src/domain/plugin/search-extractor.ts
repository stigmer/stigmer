/**
 * Plugin search extractor — both sides of the searchable contract (the
 * index side pipeline/steps/index-search.ts consumes, the query side the
 * SearchService renders). A plugin's summary is its manifest description;
 * its keywords join the tags so `stigmer list plugin` and the console's
 * search find a plugin by what its author called it.
 */
import type { Message } from "@bufbuild/protobuf";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";
import type { SearchIndexEntry } from "../../store/interface.js";

export const pluginSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,

  getSearchSummary(resource: Message): string {
    const plugin = resource as unknown as Plugin;
    return plugin.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const plugin = resource as unknown as Plugin;
    return buildSearchResult({
      kind: ApiResourceKind.plugin,
      metadata: plugin.metadata,
      summary: plugin.spec?.description ?? "",
      score,
      createdAt: plugin.status?.audit?.specAudit?.createdAt,
      updatedAt: plugin.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const plugin = resource as unknown as Plugin;
    const metadata = plugin.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: plugin.spec?.description ?? "",
      // The index carries one tags string; the manifest's keywords are
      // what an author expects a search to match, so they join the tags.
      tags: [...metadata.tags, ...(plugin.spec?.keywords ?? [])].join(" "),
      org: metadata.org,
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        plugin.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

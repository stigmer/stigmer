/**
 * Environment search extractor — ports pkg/query/search/extractor/
 * environment_extractor.go (both sides: the #4 index side, the #14 query
 * side; the search summary is spec.description). Secret DATA is
 * deliberately never indexed — only name, description, tags, org, and
 * visibility reach FTS5, and the query projection carries the same
 * non-secret fields.
 */
import type { Message } from "@bufbuild/protobuf";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const environmentSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.environment,
  schema: EnvironmentSchema,

  getSearchSummary(resource: Message): string {
    // Go EnvironmentExtractor.GetSearchSummary: spec.description.
    const env = resource as unknown as Environment;
    return env.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const env = resource as unknown as Environment;
    return buildSearchResult({
      kind: ApiResourceKind.environment,
      metadata: env.metadata,
      summary: env.spec?.description ?? "",
      score,
      createdAt: env.status?.audit?.specAudit?.createdAt,
      updatedAt: env.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const env = resource as unknown as Environment;
    const metadata = env.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: env.spec?.description ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        env.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

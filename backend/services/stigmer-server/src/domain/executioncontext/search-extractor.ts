/**
 * ExecutionContext search extractor — ports pkg/query/search/extractor/
 * execution_context_extractor.go (both sides: the #4 index side, the #14
 * query side). Execution contexts have no description field, so the
 * summary is empty everywhere — and secret DATA is deliberately never
 * indexed nor projected: only name, tags, org, and visibility reach the
 * search index and the SearchResult.
 */
import type { Message } from "@bufbuild/protobuf";

import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const executionContextSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.execution_context,
  schema: ExecutionContextSchema,

  getSearchSummary(): string {
    // Go ExecutionContextExtractor.GetSearchSummary: always "".
    return "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const ec = resource as unknown as ExecutionContext;
    return buildSearchResult({
      kind: ApiResourceKind.execution_context,
      metadata: ec.metadata,
      summary: "",
      score,
      createdAt: ec.status?.audit?.specAudit?.createdAt,
      updatedAt: ec.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const ec = resource as unknown as ExecutionContext;
    const metadata = ec.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // No description field on the spec; Go's GetSearchSummary returns "".
      description: "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(ec.status?.audit?.specAudit?.createdAt?.seconds ?? 0n),
    };
  },
};

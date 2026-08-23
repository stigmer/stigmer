/**
 * ExecutionContext search extractor — ports the GetSearchIndexEntry side
 * of pkg/query/search/extractor/execution_context_extractor.go. Execution
 * contexts have no description field, so the summary is empty — and
 * secret DATA is deliberately never indexed: only name, tags, org, and
 * visibility reach FTS5. The query side of the extractor contract
 * (ToSearchResult) arrives with the search service sub-project (#14
 * sp.search-and-activity).
 */
import type { Message } from "@bufbuild/protobuf";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const executionContextSearchExtractor: SearchIndexExtractor = {
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
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(ec.status?.audit?.specAudit?.createdAt?.seconds ?? 0n),
    };
  },
};

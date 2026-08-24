/**
 * McpServer search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/mcpserver_extractor.go. The search summary is
 * spec.description. The query side of the extractor contract arrives with
 * the search service sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const mcpServerSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const mcpServer = resource as unknown as McpServer;
    const metadata = mcpServer.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // Go McpServerExtractor.GetSearchSummary: spec.description.
      description: mcpServer.spec?.description ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        mcpServer.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

/**
 * McpServer search extractor — ports pkg/query/search/extractor/
 * mcpserver_extractor.go (both sides: the #4 index side, the #14 query
 * side). The search summary is spec.description; MCP servers are one of
 * the two kinds carrying an icon_url on the search projection.
 */
import type { Message } from "@bufbuild/protobuf";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const mcpServerSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.mcp_server,
  schema: McpServerSchema,

  getSearchSummary(resource: Message): string {
    // Go McpServerExtractor.GetSearchSummary: spec.description.
    const mcpServer = resource as unknown as McpServer;
    return mcpServer.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const mcpServer = resource as unknown as McpServer;
    return buildSearchResult({
      kind: ApiResourceKind.mcp_server,
      metadata: mcpServer.metadata,
      summary: mcpServer.spec?.description ?? "",
      score,
      createdAt: mcpServer.status?.audit?.specAudit?.createdAt,
      updatedAt: mcpServer.status?.audit?.specAudit?.updatedAt,
      iconUrl: mcpServer.spec?.iconUrl ?? "",
    });
  },

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

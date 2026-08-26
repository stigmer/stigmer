/**
 * AgentExecution search extractor — ports pkg/query/search/extractor/
 * agent_execution_extractor.go (both sides: the #4 index side, the #14
 * query side). Agent executions are individual invocation records with no
 * description field. Go's GetSearchSummary returns metadata.name, but BOTH
 * projections deliberately ignore it: ToSearchResult pins Description ""
 * (extractor line 59) and GetSearchIndexEntry leaves the FTS description
 * at its zero value — the name is already the top-weighted indexed column.
 * That asymmetry is Go's, ported as-is.
 */
import type { Message } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const agentExecutionSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.agent_execution,
  schema: AgentExecutionSchema,

  getSearchSummary(resource: Message): string {
    // Go AgentExecutionExtractor.GetSearchSummary: metadata.name. Neither
    // projection consumes it (see the header) — the interface contract is
    // still served for any caller that does.
    const execution = resource as unknown as AgentExecution;
    return execution.metadata?.name ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const execution = resource as unknown as AgentExecution;
    return buildSearchResult({
      kind: ApiResourceKind.agent_execution,
      metadata: execution.metadata,
      // Go pins Description "" here — NOT GetSearchSummary.
      summary: "",
      score,
      createdAt: execution.status?.audit?.specAudit?.createdAt,
      updatedAt: execution.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const execution = resource as unknown as AgentExecution;
    const metadata = execution.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // No description field on executions (Go leaves entry.Description
      // at its zero value).
      description: "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        execution.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

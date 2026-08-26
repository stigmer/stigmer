/**
 * Agent search extractor — ports pkg/query/search/extractor/
 * agent_extractor.go (both sides: the #4 index side, the #14 query side).
 * The search summary uses spec.description if available, falling back to
 * instructions (the system prompt) — the common pattern where older agents
 * may not have a dedicated description field, but all agents have
 * instructions. Agents are one of the two kinds carrying an icon_url on
 * the search projection.
 */
import type { Message } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const agentSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.agent,
  schema: AgentSchema,

  getSearchSummary(resource: Message): string {
    return agentSearchSummary(resource as unknown as Agent);
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const agent = resource as unknown as Agent;
    return buildSearchResult({
      kind: ApiResourceKind.agent,
      metadata: agent.metadata,
      summary: agentSearchSummary(agent),
      score,
      createdAt: agent.status?.audit?.specAudit?.createdAt,
      updatedAt: agent.status?.audit?.specAudit?.updatedAt,
      iconUrl: agent.spec?.iconUrl ?? "",
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const agent = resource as unknown as Agent;
    const metadata = agent.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: agentSearchSummary(agent),
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        agent.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

/** Go AgentExtractor.GetSearchSummary: description, else instructions. */
function agentSearchSummary(agent: Agent): string {
  const spec = agent.spec;
  if (spec === undefined) {
    return "";
  }
  return spec.description !== "" ? spec.description : spec.instructions;
}

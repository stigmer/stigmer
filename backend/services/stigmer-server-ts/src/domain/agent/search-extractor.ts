/**
 * Agent search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/agent_extractor.go. The search summary uses
 * spec.description if available, falling back to instructions (the system
 * prompt) — the common pattern where older agents may not have a dedicated
 * description field, but all agents have instructions. The query side of
 * the extractor contract arrives with the search service sub-project
 * (#13), exactly as the organization extractor's header records.
 */
import type { Message } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const agentSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const agent = resource as unknown as Agent;
    const metadata = agent.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: agentSearchSummary(agent),
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

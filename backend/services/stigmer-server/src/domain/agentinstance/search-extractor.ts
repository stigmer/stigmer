/**
 * AgentInstance search extractor — ports pkg/query/search/extractor/
 * agent_instance_extractor.go (both sides: the #4 index side, the #14
 * query side). Agent instances are configured incarnations of an agent
 * blueprint; the summary is spec.description.
 */
import type { Message } from "@bufbuild/protobuf";

import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const agentInstanceSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.agent_instance,
  schema: AgentInstanceSchema,

  getSearchSummary(resource: Message): string {
    // Go AgentInstanceExtractor.GetSearchSummary: spec.description.
    const instance = resource as unknown as AgentInstance;
    return instance.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const instance = resource as unknown as AgentInstance;
    return buildSearchResult({
      kind: ApiResourceKind.agent_instance,
      metadata: instance.metadata,
      summary: instance.spec?.description ?? "",
      score,
      createdAt: instance.status?.audit?.specAudit?.createdAt,
      updatedAt: instance.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const instance = resource as unknown as AgentInstance;
    const metadata = instance.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: instance.spec?.description ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        instance.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

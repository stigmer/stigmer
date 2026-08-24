/**
 * AgentInstance search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/agent_instance_extractor.go. Agent instances
 * are configured incarnations of an agent blueprint; the summary is
 * spec.description. The query side of the extractor contract arrives with
 * the search service sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const agentInstanceSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const instance = resource as unknown as AgentInstance;
    const metadata = instance.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: instance.spec?.description ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

/**
 * AgentExecution search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/agent_execution_extractor.go. Agent
 * executions are individual invocation records; they have no description
 * field, so the FTS description stays empty and the name is the summary.
 * The query side of the extractor contract arrives with the search
 * service sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const agentExecutionSearchExtractor: SearchIndexExtractor = {
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
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

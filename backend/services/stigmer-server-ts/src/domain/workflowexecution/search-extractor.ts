/**
 * WorkflowExecution search extractor — ports the GetSearchIndexEntry side
 * of pkg/query/search/extractor/workflow_execution_extractor.go. Workflow
 * executions are invocation records; they have no description field, so
 * the FTS description stays empty. The query side of the extractor
 * contract arrives with the search service sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";
import type { SearchIndexEntry } from "../../store/interface.js";

export const workflowExecutionSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const execution = resource as unknown as WorkflowExecution;
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

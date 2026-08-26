/**
 * WorkflowExecution search extractor — ports pkg/query/search/extractor/
 * workflow_execution_extractor.go (both sides: the #4 index side, the #14
 * query side). Workflow executions are invocation records with no
 * description field: Go's GetSearchSummary returns "" and BOTH
 * projections leave the description at its zero value.
 */
import type { Message } from "@bufbuild/protobuf";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchableExtractor } from "../../query/search/extractor.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchIndexEntry } from "../../store/interface.js";

export const workflowExecutionSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.workflow_execution,
  schema: WorkflowExecutionSchema,

  getSearchSummary(): string {
    // Go WorkflowExecutionExtractor.GetSearchSummary: always "".
    return "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const execution = resource as unknown as WorkflowExecution;
    return buildSearchResult({
      kind: ApiResourceKind.workflow_execution,
      metadata: execution.metadata,
      summary: "",
      score,
      createdAt: execution.status?.audit?.specAudit?.createdAt,
      updatedAt: execution.status?.audit?.specAudit?.updatedAt,
    });
  },

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

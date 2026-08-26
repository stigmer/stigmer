/**
 * Workflow search extractor — ports pkg/query/search/extractor/
 * workflow_extractor.go (both sides: the #4 index side, the #14 query
 * side). The search summary is spec.description (workflows are serverless
 * workflow definitions; the spec-level description is the authored
 * summary).
 */
import type { Message } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const workflowSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.workflow,
  schema: WorkflowSchema,

  getSearchSummary(resource: Message): string {
    // Go WorkflowExtractor.GetSearchSummary: spec.description.
    const workflow = resource as unknown as Workflow;
    return workflow.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const workflow = resource as unknown as Workflow;
    return buildSearchResult({
      kind: ApiResourceKind.workflow,
      metadata: workflow.metadata,
      summary: workflow.spec?.description ?? "",
      score,
      createdAt: workflow.status?.audit?.specAudit?.createdAt,
      updatedAt: workflow.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const workflow = resource as unknown as Workflow;
    const metadata = workflow.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // Go WorkflowExtractor.GetSearchSummary: spec.description.
      description: workflow.spec?.description ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        workflow.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

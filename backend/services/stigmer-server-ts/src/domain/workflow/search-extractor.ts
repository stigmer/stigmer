/**
 * Workflow search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/workflow_extractor.go. The search summary is
 * spec.description (workflows are serverless workflow definitions; the
 * spec-level description is the authored summary). The query side of the
 * extractor contract arrives with the search service sub-project (#14),
 * exactly as the organization extractor's header records.
 */
import type { Message } from "@bufbuild/protobuf";

import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const workflowSearchExtractor: SearchIndexExtractor = {
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
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

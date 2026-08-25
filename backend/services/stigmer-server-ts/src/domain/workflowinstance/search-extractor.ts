/**
 * WorkflowInstance search extractor — ports pkg/query/search/extractor/
 * workflow_instance_extractor.go (both sides: the #4 index side, the #14
 * query side). The search summary is spec.description (for the default
 * instance that is the factory's canonical copy).
 */
import type { Message } from "@bufbuild/protobuf";

import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const workflowInstanceSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.workflow_instance,
  schema: WorkflowInstanceSchema,

  getSearchSummary(resource: Message): string {
    // Go WorkflowInstanceExtractor.GetSearchSummary: spec.description.
    const instance = resource as unknown as WorkflowInstance;
    return instance.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const instance = resource as unknown as WorkflowInstance;
    return buildSearchResult({
      kind: ApiResourceKind.workflow_instance,
      metadata: instance.metadata,
      summary: instance.spec?.description ?? "",
      score,
      createdAt: instance.status?.audit?.specAudit?.createdAt,
      updatedAt: instance.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const instance = resource as unknown as WorkflowInstance;
    const metadata = instance.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // Go WorkflowInstanceExtractor.GetSearchSummary: spec.description.
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

/**
 * Run search extractor (both sides: the index side, the query side). Runs
 * are individual invocation records with no description field.
 * getSearchSummary returns metadata.name, but BOTH projections
 * deliberately ignore it: toSearchResult pins the description "" and
 * getSearchIndexEntry leaves the FTS description empty — the name is
 * already the top-weighted indexed column.
 */
import type { Message } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const agentExecutionSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.run,
  schema: RunSchema,

  getSearchSummary(resource: Message): string {
    // metadata.name. Neither projection consumes it (see the header) — the interface contract is
    // still served for any caller that does.
    const execution = resource as unknown as Run;
    return execution.metadata?.name ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const execution = resource as unknown as Run;
    return buildSearchResult({
      kind: ApiResourceKind.run,
      metadata: execution.metadata,
      // The description is "" here — NOT getSearchSummary.
      summary: "",
      score,
      createdAt: execution.status?.audit?.specAudit?.createdAt,
      updatedAt: execution.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const execution = resource as unknown as Run;
    const metadata = execution.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // No description field on runs.
      description: "",
      // Tags join space-separated — the index entry carries one tags
      // string.
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string.
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        execution.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

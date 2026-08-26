/**
 * Project search extractor — ports pkg/query/search/extractor/
 * project_extractor.go (both sides; the search summary is
 * spec.description).
 *
 * Written by #14 (sp.search-and-activity) under ratified DD-D: boot
 * RebuildIndex re-indexes every registered kind from the resources table,
 * and an adopted Go database may already hold projects — without the
 * query side those rows would silently vanish from search. #16
 * (sp.project) merged first with the index-only half of this file and
 * wired it into the domain's write pipelines (IndexSearch/
 * DeleteSearchIndex steps); the #14 merge reconciled to this
 * full-contract version per the coordination note both PRs carried —
 * getSearchIndexEntry is byte-identical to #16's, so the domain's write
 * path is unchanged.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import type { Project } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const projectSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.project,
  schema: ProjectSchema,

  getSearchSummary(resource: Message): string {
    // Go ProjectExtractor.GetSearchSummary: spec.description.
    const project = resource as unknown as Project;
    return project.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const project = resource as unknown as Project;
    return buildSearchResult({
      kind: ApiResourceKind.project,
      metadata: project.metadata,
      summary: project.spec?.description ?? "",
      score,
      createdAt: project.status?.audit?.specAudit?.createdAt,
      updatedAt: project.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const project = resource as unknown as Project;
    const metadata = project.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: project.spec?.description ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        project.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

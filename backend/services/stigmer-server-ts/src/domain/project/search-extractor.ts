/**
 * Project search extractor — ports pkg/query/search/extractor/
 * project_extractor.go (both sides; the search summary is
 * spec.description).
 *
 * Shipped by #14 (sp.search-and-activity) AHEAD of the project domain
 * port (#16, in flight): boot RebuildIndex re-indexes every registered
 * kind from the resources table, and an adopted Go database may already
 * hold projects — without this extractor those rows would silently vanish
 * from search (D4 #14 DD-D, owner-ratified). The extractor depends only
 * on the generated Project proto; #16 wires it into the domain's write
 * pipelines (IndexSearch/DeleteSearchIndex steps) when the domain lands.
 * Coordination note on both PRs: #16's branch creates this same file
 * (index side only) — second-to-merge reconciles to this full-contract
 * version.
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
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

/**
 * Project search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/project_extractor.go (the search summary is
 * spec.description, empty without a spec). Indexed domains carry their
 * extractors (D4); the QUERY side of the extractor contract (ToSearchResult,
 * the registry validation) arrives with the search service sub-project
 * (#14) — only the write-path extraction the IndexSearch step needs lives
 * here.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Project } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";
import type { SearchIndexEntry } from "../../store/interface.js";

export const projectSearchExtractor: SearchIndexExtractor = {
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

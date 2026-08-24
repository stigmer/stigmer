/**
 * Organization search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/organization_extractor.go (the search summary
 * is spec.description). Indexed domains carry their extractors (D4); the
 * QUERY side of the extractor contract (ToSearchResult, the registry
 * validation) arrives with the search service sub-project (#14) — only the
 * write-path extraction the IndexSearch step needs lives here.
 */
import type { Message } from "@bufbuild/protobuf";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const organizationSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const org = resource as unknown as Organization;
    const metadata = org.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: org.spec?.description ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        org.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

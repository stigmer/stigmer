/**
 * Organization search extractor — ports pkg/query/search/extractor/
 * organization_extractor.go (both sides: the #4 index side, the #14 query
 * side; the search summary is spec.description). Organizations are the
 * top-level container for all Stigmer resources.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const organizationSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.organization,
  schema: OrganizationSchema,

  getSearchSummary(resource: Message): string {
    // Go OrganizationExtractor.GetSearchSummary: spec.description.
    const org = resource as unknown as Organization;
    return org.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const org = resource as unknown as Organization;
    return buildSearchResult({
      kind: ApiResourceKind.organization,
      metadata: org.metadata,
      summary: org.spec?.description ?? "",
      score,
      createdAt: org.status?.audit?.specAudit?.createdAt,
      updatedAt: org.status?.audit?.specAudit?.updatedAt,
    });
  },

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

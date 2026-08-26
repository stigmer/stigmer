/**
 * Session search extractor — ports pkg/query/search/extractor/
 * session_extractor.go (both sides: the #4 index side, the #14 query
 * side). Sessions are conversation threads between a user and an agent
 * instance; the summary is spec.subject (the conversation topic).
 */
import type { Message } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const sessionSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.session,
  schema: SessionSchema,

  getSearchSummary(resource: Message): string {
    // Go SessionExtractor.GetSearchSummary: spec.subject.
    const session = resource as unknown as Session;
    return session.spec?.subject ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const session = resource as unknown as Session;
    return buildSearchResult({
      kind: ApiResourceKind.session,
      metadata: session.metadata,
      summary: session.spec?.subject ?? "",
      score,
      createdAt: session.status?.audit?.specAudit?.createdAt,
      updatedAt: session.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const session = resource as unknown as Session;
    const metadata = session.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: session.spec?.subject ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        session.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

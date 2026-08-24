/**
 * Session search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/session_extractor.go. Sessions are
 * conversation threads between a user and an agent instance; the summary
 * is spec.subject (the conversation topic). The query side of the
 * extractor contract arrives with the search service sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const sessionSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const session = resource as unknown as Session;
    const metadata = session.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: session.spec?.subject ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
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

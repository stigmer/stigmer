/**
 * Environment search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/environment_extractor.go (the search summary
 * is spec.description). Secret DATA is deliberately never indexed — only
 * name, description, tags, org, and visibility reach FTS5. The query side
 * of the extractor contract arrives with the search service sub-project
 * (#13), exactly as the organization extractor's header records.
 */
import type { Message } from "@bufbuild/protobuf";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const environmentSearchExtractor: SearchIndexExtractor = {
  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const env = resource as unknown as Environment;
    const metadata = env.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      description: env.spec?.description ?? "",
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        env.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};

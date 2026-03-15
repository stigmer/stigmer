import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import {
  SearchRequestSchema,
  type SearchResponse,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(SearchService, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SearchResourcesOptions {
  query: string;
  org?: string;
  excludePublic?: boolean;
  page?: { num: number; size: number };
}

/**
 * Search for resources of a specific kind.
 *
 * With an empty query, returns all accessible resources sorted by creation
 * date (newest first). With a query, returns relevance-ranked results.
 *
 * The `org` field is optional — when omitted the server searches across all
 * orgs the caller is a member of.
 */
export async function searchResources(
  kind: ApiResourceKind,
  options: SearchResourcesOptions,
): Promise<SearchResponse> {
  const request = create(SearchRequestSchema, {
    kinds: [kind],
    query: options.query,
    org: options.org ?? "",
    excludePublic: options.excludePublic ?? false,
    page: options.page
      ? create(PageInfoSchema, {
          num: options.page.num,
          size: options.page.size,
        })
      : undefined,
  });

  return client.search(request) as Promise<SearchResponse>;
}

export async function searchAgents(
  options: SearchResourcesOptions,
): Promise<SearchResponse> {
  return searchResources(ApiResourceKind.agent, options);
}

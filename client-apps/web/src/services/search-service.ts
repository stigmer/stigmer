import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  SearchService,
} from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import {
  SearchRequestSchema,
  type SearchResponse,
  type SearchResult,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import {
  ApiResourceKind,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  PageInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";

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

export { ApiResourceKind };
export type { SearchResponse, SearchResult };

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

export async function searchSkills(
  options: SearchResourcesOptions,
): Promise<SearchResponse> {
  return searchResources(ApiResourceKind.skill, options);
}

export async function searchMcpServers(
  options: SearchResourcesOptions,
): Promise<SearchResponse> {
  return searchResources(ApiResourceKind.mcp_server, options);
}

// ---------------------------------------------------------------------------
// Unified Catalog
// ---------------------------------------------------------------------------

export interface SearchCatalogOptions {
  kinds?: ApiResourceKind[];
  query: string;
  org?: string;
  excludePublic?: boolean;
  page?: { num: number; size: number };
}

/**
 * Search across multiple resource kinds simultaneously.
 *
 * When `kinds` is empty or omitted the server searches all searchable kinds
 * (agent, skill, mcp_server, workflow) in discover mode. The response
 * includes `countsByKind` with totals per kind — useful for rendering
 * filter tabs with counts.
 */
export async function searchCatalog(
  options: SearchCatalogOptions,
): Promise<SearchResponse> {
  const request = create(SearchRequestSchema, {
    kinds: options.kinds ?? [],
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

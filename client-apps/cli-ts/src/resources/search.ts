// `search` dispatch: a relevance-ranked, cross-resource text query over the
// unified SearchService. Only agents and workflows are search-indexed (matching
// the Go CLI). Results render identically to `list` (the shared SEARCH_TABLE),
// with a pagination footer the command appends for human output.

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { OutputFormat } from "../output/index.js";
import { SEARCH_TABLE } from "./list.js";
import { renderCollection } from "./render.js";

export interface SearchParams {
  /** Organization scope. Empty searches across all accessible orgs (incl. public). */
  readonly org: string;
  /** Exclude public/platform resources, restricting to the caller's own. */
  readonly excludePublic: boolean;
  /** 1-indexed page number. */
  readonly page: number;
  /** Results per page. */
  readonly pageSize: number;
}

export interface SearchOutcome {
  /** Rendered entries (table grid, or protojson array for json/yaml). */
  readonly rendered: string;
  readonly page: number;
  readonly totalPages: number;
  readonly totalCount: number;
}

export async function searchResources(
  client: Stigmer,
  kind: ApiResourceKind,
  query: string,
  params: SearchParams,
  format: OutputFormat,
): Promise<SearchOutcome> {
  const response = await client.search.query({
    kinds: [kind],
    query,
    org: params.org,
    excludePublic: params.excludePublic,
    page: { num: params.page, size: params.pageSize },
  });

  return {
    rendered: renderCollection(SearchResultSchema, response.entries, format, SEARCH_TABLE),
    page: params.page,
    totalPages: response.totalPages,
    totalCount: response.totalCount,
  };
}

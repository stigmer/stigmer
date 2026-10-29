// `search` dispatch: a relevance-ranked, cross-resource text query over the
// unified SearchService. Only agents take the `search` verb. Results render as SEARCH_TABLE, with a footer the command appends
// for human output (how many match, and how to read the next page), and
// name each result's organization by slug as `list` does.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchResultSchema } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import type { OutputFormat } from "../output/index.js";
import { organizationLabels } from "../client/organizations.js";
import { SEARCH_TABLE } from "./list.js";
import { renderCollection, tableOrganizations } from "./render.js";

export interface SearchParams {
  /** Organization scope. Empty searches across every org the caller can access. */
  readonly org: string;
  /** Results per page. */
  readonly pageSize: number;
  /** The previous page's token, to continue the same query; "" for the first page. */
  readonly pageToken: string;
}

export interface SearchOutcome {
  /** Rendered entries (table grid, or protojson array for json/yaml). */
  readonly rendered: string;
  /** How many results match across every page, by the server's count for the kind. */
  readonly matches: number;
  /** The token that reads the next page; "" when this page is the last. */
  readonly nextPageToken: string;
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
    pageSize: params.pageSize,
    pageToken: params.pageToken,
  });

  return {
    rendered: renderCollection(
      SearchResultSchema,
      response.entries,
      format,
      SEARCH_TABLE,
      await organizationLabels(
        client,
        tableOrganizations(SearchResultSchema, response.entries, format, SEARCH_TABLE),
      ),
    ),
    matches: response.countsByKind[ApiResourceKind[kind]] ?? response.entries.length,
    nextPageToken: response.nextPageToken,
  };
}

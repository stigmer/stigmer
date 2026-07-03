import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { SearchRequestSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { wrapError } from "./gen/errors.js";

/** Re-export ApiResourceKind for use with SearchClient. */
export { ApiResourceKind };

/** Parameters for a cross-resource search query. */
export interface SearchParams {
  /** Resource kinds to include in the search. */
  readonly kinds: ApiResourceKind[];
  /** Organization slug to scope the query. */
  readonly org: string;
  /** Free-text search query. */
  readonly query?: string;
  /** Whether to exclude public (non-org) resources from results. */
  readonly excludePublic?: boolean;
  /** Pagination parameters. */
  readonly page?: { num: number; size: number };
}

/** A page of cross-resource search results. */
export interface SearchResponse {
  readonly entries: SearchResult[];
  readonly totalCount: number;
  readonly totalPages: number;
}

/**
 * Cross-resource search client.
 *
 * Unlike the per-resource `list()` methods (which search within a single
 * resource kind), `SearchClient.query()` searches across multiple resource
 * kinds in a single call.
 */
export class SearchClient {
  private readonly search: Client<typeof SearchService>;

  constructor(transport: Transport) {
    this.search = createClient(SearchService, transport);
  }

  /** Perform a cross-resource search. */
  async query(params: SearchParams): Promise<SearchResponse> {
    try {
      const resp = await this.search.search(
        create(SearchRequestSchema, {
          kinds: params.kinds,
          query: params.query,
          org: params.org,
          excludePublic: params.excludePublic ?? false,
          page: params.page
            ? create(PageInfoSchema, params.page)
            : undefined,
        }),
      );
      return {
        entries: resp.entries,
        totalCount: resp.totalCount,
        totalPages: resp.totalPages,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }
}

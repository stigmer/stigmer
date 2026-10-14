import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { SearchRequestSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { wrapError } from "./gen/errors.js";
import { everyEntry } from "./pages.js";

/** Re-export ApiResourceKind for use with SearchClient. */
export { ApiResourceKind };

/** Parameters for a cross-resource search query. */
export interface SearchParams {
  /** Resource kinds to include in the search. */
  readonly kinds: ApiResourceKind[];
  /** The organization to scope the query, by id or slug. */
  readonly org: string;
  /** Free-text search query. */
  readonly query?: string;
  /** The most results to return: 0 or unset asks for the default page of 50, and above 100 reads 100. */
  readonly pageSize?: number;
  /** The previous response's `nextPageToken`, to continue the same query. */
  readonly pageToken?: string;
}

/** A page of cross-resource search results. */
export interface SearchResponse {
  readonly entries: SearchResult[];
  /** Matches per resource kind across every page, keyed by kind name. */
  readonly countsByKind: Readonly<Record<string, number>>;
  /** Set when more results may follow: pass it as `pageToken` to continue. */
  readonly nextPageToken: string;
}

/**
 * Cross-resource search client.
 *
 * The per-resource `list()` methods browse one kind's resources, newest
 * first; `SearchClient.query()` finds resources of one or more kinds by
 * their words, in relevance order. Both page by token.
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
          pageSize: params.pageSize,
          pageToken: params.pageToken,
        }),
      );
      return {
        entries: resp.entries,
        countsByKind: resp.countsByKind,
        nextPageToken: resp.nextPageToken,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Every result of a search, page after page, following `nextPageToken`
   * from the token the params name. Breaking out of the loop stops the reads.
   */
  queryAll(params: SearchParams): AsyncGenerator<SearchResult> {
    return everyEntry(
      (pageToken) => this.query({ ...params, pageToken }),
      params.pageToken ?? "",
    );
  }
}

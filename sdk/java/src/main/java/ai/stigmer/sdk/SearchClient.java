package ai.stigmer.sdk;

import ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind;
import ai.stigmer.commons.rpc.PageInfo;
import ai.stigmer.sdk.internal.gen.Page;
import ai.stigmer.sdk.internal.gen.StigmerException;
import ai.stigmer.search.v1.SearchRequest;
import ai.stigmer.search.v1.SearchResult;
import ai.stigmer.search.v1.SearchServiceGrpc;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.List;
import java.util.Objects;

/**
 * Cross-resource search client.
 *
 * <p>Unlike the per-resource {@code list()} methods (which search within a
 * single resource kind), {@code SearchClient.query()} searches across multiple
 * resource kinds in a single call.
 *
 * <pre>{@code
 * SearchClient.SearchResponse results = client.search().query(
 *     SearchClient.SearchParams.builder()
 *         .org("my-org")
 *         .kinds(List.of(ApiResourceKind.agent, ApiResourceKind.skill))
 *         .query("my-agent")
 *         .build());
 * }</pre>
 */
public final class SearchClient {

    private final SearchServiceGrpc.SearchServiceBlockingStub stub;

    SearchClient(Channel channel) {
        this.stub = SearchServiceGrpc.newBlockingStub(channel);
    }

    /** Performs a cross-resource search. */
    public SearchResponse query(SearchParams params) {
        try {
            SearchRequest.Builder req = SearchRequest.newBuilder()
                    .addAllKinds(params.kinds)
                    .setOrg(params.org)
                    .setExcludePublic(params.excludePublic);

            if (params.query != null) {
                req.setQuery(params.query);
            }
            if (params.page != null) {
                req.setPage(PageInfo.newBuilder()
                        .setNum(params.page.getNum())
                        .setSize(params.page.getSize())
                        .build());
            }

            ai.stigmer.search.v1.SearchResponse resp = stub.search(req.build());
            return new SearchResponse(
                    resp.getEntriesList(),
                    resp.getTotalCount(),
                    resp.getTotalPages());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- SearchParams ---------------------------------------------------------

    /** Parameters for a cross-resource search query. */
    public static final class SearchParams {
        final List<ApiResourceKind> kinds;
        final String org;
        final String query;
        final boolean excludePublic;
        final Page page;

        private SearchParams(Builder builder) {
            this.kinds = builder.kinds;
            this.org = builder.org;
            this.query = builder.query;
            this.excludePublic = builder.excludePublic;
            this.page = builder.page;
        }

        public static Builder builder() { return new Builder(); }

        public static final class Builder {
            private List<ApiResourceKind> kinds = List.of();
            private String org;
            private String query;
            private boolean excludePublic;
            private Page page;

            private Builder() {}

            /** Resource kinds to include in the search. */
            public Builder kinds(List<ApiResourceKind> kinds) {
                this.kinds = Objects.requireNonNull(kinds);
                return this;
            }

            /** Organization slug to scope the query (required). */
            public Builder org(String org) {
                this.org = org;
                return this;
            }

            /** Free-text search query. */
            public Builder query(String query) {
                this.query = query;
                return this;
            }

            /** Whether to exclude public (non-org) resources from results. */
            public Builder excludePublic(boolean excludePublic) {
                this.excludePublic = excludePublic;
                return this;
            }

            /** Pagination parameters. */
            public Builder page(Page page) {
                this.page = page;
                return this;
            }

            public SearchParams build() {
                Objects.requireNonNull(org, "org is required for search");
                return new SearchParams(this);
            }
        }
    }

    // -- SearchResponse -------------------------------------------------------

    /** A page of cross-resource search results. */
    public static final class SearchResponse {
        private final List<SearchResult> entries;
        private final int totalCount;
        private final int totalPages;

        SearchResponse(List<SearchResult> entries, int totalCount, int totalPages) {
            this.entries = entries;
            this.totalCount = totalCount;
            this.totalPages = totalPages;
        }

        public List<SearchResult> getEntries() { return entries; }
        public int getTotalCount() { return totalCount; }
        public int getTotalPages() { return totalPages; }
    }
}

package ai.stigmer.sdk;

import ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind;
import ai.stigmer.sdk.gen.Pages;
import ai.stigmer.sdk.gen.StigmerException;
import ai.stigmer.search.v1.SearchRequest;
import ai.stigmer.search.v1.SearchResult;
import ai.stigmer.search.v1.SearchServiceGrpc;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Cross-resource search client.
 *
 * <p>Unlike the per-resource {@code list()} methods (which browse one
 * resource kind), {@code SearchClient.query()} finds resources of several
 * kinds by their words in a single call.
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
                    .setOrg(params.org);

            if (params.query != null) {
                req.setQuery(params.query);
            }
            req.setPageSize(params.pageSize).setPageToken(params.pageToken);

            ai.stigmer.search.v1.SearchResponse resp = stub.search(req.build());
            return new SearchResponse(
                    resp.getEntriesList(),
                    resp.getCountsByKindMap(),
                    resp.getNextPageToken());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Every result of a search, page after page: follows the next page token
     * from the token the params name until the results end. Each page is
     * read as the iteration reaches it.
     */
    public Iterable<SearchResult> queryAll(SearchParams params) {
        return Pages.<SearchResponse, SearchResult>iterate(
                params.pageToken,
                token -> query(params.withPageToken(token)),
                SearchResponse::getEntries,
                SearchResponse::getNextPageToken);
    }

    // -- SearchParams ---------------------------------------------------------

    /** Parameters for a cross-resource search query. */
    public static final class SearchParams {
        final List<ApiResourceKind> kinds;
        final String org;
        final String query;
        final int pageSize;
        final String pageToken;

        private SearchParams(Builder builder) {
            this.kinds = builder.kinds;
            this.org = builder.org;
            this.query = builder.query;
            this.pageSize = builder.pageSize;
            this.pageToken = builder.pageToken;
        }

        public static Builder builder() { return new Builder(); }

        SearchParams withPageToken(String token) {
            Builder b = builder().kinds(kinds).org(org).query(query).pageSize(pageSize);
            return b.pageToken(token).build();
        }

        public static final class Builder {
            private List<ApiResourceKind> kinds = List.of();
            private String org = "";
            private String query;
            private int pageSize;
            private String pageToken = "";

            private Builder() {}

            /** Resource kinds to include in the search. */
            public Builder kinds(List<ApiResourceKind> kinds) {
                this.kinds = Objects.requireNonNull(kinds);
                return this;
            }

            /**
             * Organization slug to scope the query. Leave it unset to search
             * every organization the caller can see; a server that holds one
             * organization fills its own.
             */
            public Builder org(String org) {
                this.org = Objects.requireNonNull(org);
                return this;
            }

            /** Free-text search query. */
            public Builder query(String query) {
                this.query = query;
                return this;
            }

            /** The most results to return: 0 asks for the default page of 50, and above 100 reads 100. */
            public Builder pageSize(int pageSize) {
                this.pageSize = pageSize;
                return this;
            }

            /** The previous response's next page token, to continue the same query. */
            public Builder pageToken(String pageToken) {
                this.pageToken = Objects.requireNonNull(pageToken);
                return this;
            }

            public SearchParams build() {
                return new SearchParams(this);
            }
        }
    }

    // -- SearchResponse -------------------------------------------------------

    /** A page of cross-resource search results. */
    public static final class SearchResponse {
        private final List<SearchResult> entries;
        private final Map<String, Integer> countsByKind;
        private final String nextPageToken;

        SearchResponse(List<SearchResult> entries, Map<String, Integer> countsByKind, String nextPageToken) {
            this.entries = entries;
            this.countsByKind = countsByKind;
            this.nextPageToken = nextPageToken;
        }

        public List<SearchResult> getEntries() { return entries; }
        /** Matches per resource kind across every page, keyed by kind name. */
        public Map<String, Integer> getCountsByKind() { return countsByKind; }
        /** Set when more results may follow: pass it as the page token to continue. */
        public String getNextPageToken() { return nextPageToken; }
    }
}

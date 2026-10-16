package stigmer

import (
	"context"
	"iter"

	"go.stigmer.ai/sdk/internal/gen"
	apiresourcekind "go.stigmer.ai/sdk/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "go.stigmer.ai/sdk/proto/ai/stigmer/search/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// ResourceKind re-exports the proto-defined API resource kind enum.
type ResourceKind = apiresourcekind.ApiResourceKind

const (
	KindAgent   = apiresourcekind.ApiResourceKind_agent
	KindSkill   = apiresourcekind.ApiResourceKind_skill
	KindPlugin  = apiresourcekind.ApiResourceKind_plugin
	KindSession = apiresourcekind.ApiResourceKind_session
	KindRun     = apiresourcekind.ApiResourceKind_run
)

// SearchParams configures a cross-resource search query.
type SearchParams struct {
	Kinds []ResourceKind
	Query string
	Org   string
	// PageSize is the most results to return: 0 asks for the default page
	// of 50, and above 100 reads 100.
	PageSize int32
	// PageToken is the previous response's NextPageToken, to continue the
	// same query.
	PageToken string
}

// SearchResult wraps one search hit returned by the platform.
type SearchResult = searchv1.SearchResult

// SearchResponse holds a page of search results.
type SearchResponse struct {
	Entries []*SearchResult
	// CountsByKind counts the matches per resource kind across every page,
	// keyed by kind name.
	CountsByKind map[string]int32
	// NextPageToken is set when more results may follow: pass it as
	// PageToken to continue.
	NextPageToken string
}

// SearchClient provides cross-resource search against the Stigmer platform.
type SearchClient struct {
	search searchv1.SearchServiceClient
}

func newSearchClient(conn grpc.ClientConnInterface) *SearchClient {
	return &SearchClient{search: searchv1.NewSearchServiceClient(conn)}
}

// Query performs a cross-resource search.
func (s *SearchClient) Query(ctx context.Context, params *SearchParams) (*SearchResponse, error) {
	resp, err := s.search.Search(ctx, searchRequest(params))
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &SearchResponse{
		Entries:       resp.GetEntries(),
		CountsByKind:  resp.GetCountsByKind(),
		NextPageToken: resp.GetNextPageToken(),
	}, nil
}

// QueryAll returns every result of a search, page after page: it follows
// NextPageToken from the token params names until the results end. The
// sequence yields the first error and stops; breaking out of the loop
// stops the reads.
func (s *SearchClient) QueryAll(ctx context.Context, params *SearchParams) iter.Seq2[*SearchResult, error] {
	return func(yield func(*SearchResult, error) bool) {
		req := proto.Clone(searchRequest(params)).(*searchv1.SearchRequest)
		for {
			resp, err := s.search.Search(ctx, req)
			if err != nil {
				yield(nil, gen.WrapErr(err))
				return
			}
			for _, entry := range resp.GetEntries() {
				if !yield(entry, nil) {
					return
				}
			}
			if resp.GetNextPageToken() == "" {
				return
			}
			req.PageToken = resp.GetNextPageToken()
		}
	}
}

func searchRequest(params *SearchParams) *searchv1.SearchRequest {
	return &searchv1.SearchRequest{
		Kinds:     params.Kinds,
		Query:     params.Query,
		Org:       params.Org,
		PageSize:  params.PageSize,
		PageToken: params.PageToken,
	}
}

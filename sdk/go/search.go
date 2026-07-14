package stigmer

import (
	"context"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	apiresourcekind "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	rpc "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/rpc"
	searchv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/search/v1"
	"google.golang.org/grpc"
)

// ResourceKind re-exports the proto-defined API resource kind enum.
type ResourceKind = apiresourcekind.ApiResourceKind

const (
	KindAgent     = apiresourcekind.ApiResourceKind_agent
	KindSkill     = apiresourcekind.ApiResourceKind_skill
	KindMcpServer = apiresourcekind.ApiResourceKind_mcp_server
	KindSession   = apiresourcekind.ApiResourceKind_session
	KindExecution = apiresourcekind.ApiResourceKind_agent_execution
)

// SearchParams configures a cross-resource search query.
type SearchParams struct {
	Kinds         []ResourceKind
	Query         string
	Org           string
	ExcludePublic bool
	Page          *Page
}

// SearchResult wraps one search hit returned by the platform.
type SearchResult = searchv1.SearchResult

// SearchResponse holds a page of search results.
type SearchResponse struct {
	Entries    []*SearchResult
	TotalCount int32
	TotalPages int32
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
	req := &searchv1.SearchRequest{
		Kinds:         params.Kinds,
		Query:         params.Query,
		Org:           params.Org,
		ExcludePublic: params.ExcludePublic,
	}
	if params.Page != nil {
		req.Page = &rpc.PageInfo{Num: params.Page.Num, Size: params.Page.Size}
	}
	resp, err := s.search.Search(ctx, req)
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &SearchResponse{
		Entries:    resp.GetEntries(),
		TotalCount: resp.GetTotalCount(),
		TotalPages: resp.GetTotalPages(),
	}, nil
}

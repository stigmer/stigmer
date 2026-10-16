package stigmer

// The hand-written search client: Query maps every search parameter onto
// the request and the response's entries, per-kind counts and token back;
// QueryAll walks next_page_token from the token the params name, keeps the
// query on every page, yields the first error and stops, and stops reading
// when the caller stops.

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"testing"

	searchv1 "go.stigmer.ai/sdk/proto/ai/stigmer/search/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// pagedSearchConn answers SearchService.search with five results served
// two at a time, recording each request; failAt makes that read fail.
type pagedSearchConn struct {
	grpc.ClientConnInterface
	requests []*searchv1.SearchRequest
	failAt   int
}

func (c *pagedSearchConn) Invoke(_ context.Context, method string, args, reply any, _ ...grpc.CallOption) error {
	if method != searchv1.SearchService_Search_FullMethodName {
		return fmt.Errorf("unexpected method %s", method)
	}
	req := args.(*searchv1.SearchRequest)
	c.requests = append(c.requests, proto.Clone(req).(*searchv1.SearchRequest))
	if c.failAt > 0 && len(c.requests) == c.failAt {
		return errors.New("search index down")
	}
	start := 0
	if req.GetPageToken() != "" {
		start, _ = strconv.Atoi(req.GetPageToken())
	}
	end := min(start+2, 5)
	page := &searchv1.SearchResponse{CountsByKind: map[string]int32{"agent": 5}}
	for i := start; i < end; i++ {
		page.Entries = append(page.Entries, &searchv1.SearchResult{Id: fmt.Sprintf("agt_%d", i)})
	}
	if end < 5 {
		page.NextPageToken = strconv.Itoa(end)
	}
	proto.Merge(reply.(*searchv1.SearchResponse), page)
	return nil
}

func resultIDs(results []*SearchResult) []string {
	ids := make([]string, 0, len(results))
	for _, r := range results {
		ids = append(ids, r.GetId())
	}
	return ids
}

func TestSearchQuery_MapsEveryParamAndThePageBack(t *testing.T) {
	conn := &pagedSearchConn{}
	params := &SearchParams{Kinds: []ResourceKind{KindAgent}, Query: "triage", Org: "acme", PageSize: 2, PageToken: "2"}
	resp, err := newSearchClient(conn).Query(context.Background(), params)
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	req := conn.requests[0]
	if req.GetQuery() != "triage" || req.GetOrg() != "acme" || req.GetPageSize() != 2 || req.GetPageToken() != "2" ||
		len(req.GetKinds()) != 1 || req.GetKinds()[0] != KindAgent {
		t.Errorf("request = %v", req)
	}
	if fmt.Sprint(resultIDs(resp.Entries)) != "[agt_2 agt_3]" || resp.NextPageToken != "4" || resp.CountsByKind["agent"] != 5 {
		t.Errorf("response = %v, token %q, counts %v", resultIDs(resp.Entries), resp.NextPageToken, resp.CountsByKind)
	}
}

func TestSearchQueryAll_WalksEveryPageKeepingTheQuery(t *testing.T) {
	conn := &pagedSearchConn{}
	params := &SearchParams{Kinds: []ResourceKind{KindAgent}, Query: "triage", Org: "acme", PageSize: 2}
	var ids []string
	for r, err := range newSearchClient(conn).QueryAll(context.Background(), params) {
		if err != nil {
			t.Fatalf("QueryAll: %v", err)
		}
		ids = append(ids, r.GetId())
	}
	if fmt.Sprint(ids) != "[agt_0 agt_1 agt_2 agt_3 agt_4]" {
		t.Errorf("ids = %v", ids)
	}
	var tokens []string
	for _, r := range conn.requests {
		tokens = append(tokens, r.GetPageToken())
		if r.GetQuery() != "triage" || r.GetOrg() != "acme" || r.GetPageSize() != 2 {
			t.Errorf("a page lost the query: %v", r)
		}
	}
	if fmt.Sprint(tokens) != "[ 2 4]" {
		t.Errorf("tokens = %q", tokens)
	}
	if params.PageToken != "" {
		t.Errorf("the caller's params were changed: %q", params.PageToken)
	}
}

func TestSearchQueryAll_StartsFromTheParamsToken(t *testing.T) {
	conn := &pagedSearchConn{}
	var ids []string
	for r, err := range newSearchClient(conn).QueryAll(context.Background(), &SearchParams{Query: "q", PageSize: 2, PageToken: "2"}) {
		if err != nil {
			t.Fatalf("QueryAll: %v", err)
		}
		ids = append(ids, r.GetId())
	}
	if fmt.Sprint(ids) != "[agt_2 agt_3 agt_4]" {
		t.Errorf("ids = %v", ids)
	}
}

func TestSearchQuery_WrapsTheError(t *testing.T) {
	conn := &pagedSearchConn{failAt: 1}
	if _, err := newSearchClient(conn).Query(context.Background(), &SearchParams{Query: "q"}); err == nil {
		t.Fatal("Query: want an error")
	}
}

func TestSearchQueryAll_YieldsTheFirstErrorAndStops(t *testing.T) {
	conn := &pagedSearchConn{failAt: 2}
	var ids []string
	var errs int
	for r, err := range newSearchClient(conn).QueryAll(context.Background(), &SearchParams{Query: "q", PageSize: 2}) {
		if err != nil {
			errs++
			continue
		}
		ids = append(ids, r.GetId())
	}
	if fmt.Sprint(ids) != "[agt_0 agt_1]" || errs != 1 || len(conn.requests) != 2 {
		t.Errorf("ids = %v, errors = %d, reads = %d", ids, errs, len(conn.requests))
	}
}

func TestSearchQueryAll_StopsReadingWhenTheCallerStops(t *testing.T) {
	conn := &pagedSearchConn{}
	for range newSearchClient(conn).QueryAll(context.Background(), &SearchParams{Query: "q", PageSize: 2}) {
		break
	}
	if len(conn.requests) != 1 {
		t.Errorf("reads = %d, want 1", len(conn.requests))
	}
}

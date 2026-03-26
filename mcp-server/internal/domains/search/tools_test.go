package search

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	apiresourcekind "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	rpcpb "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/rpc"
	searchv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/search/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestParseKinds_nil(t *testing.T) {
	got, err := parseKinds(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("parseKinds(nil) = %v, want nil", got)
	}
}

func TestParseKinds_empty(t *testing.T) {
	got, err := parseKinds([]string{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("parseKinds([]) = %v, want nil", got)
	}
}

func TestParseKinds_singleValid(t *testing.T) {
	tests := []struct {
		input string
		want  apiresourcekind.ApiResourceKind
	}{
		{"agent", apiresourcekind.ApiResourceKind_agent},
		{"skill", apiresourcekind.ApiResourceKind_skill},
		{"mcp_server", apiresourcekind.ApiResourceKind_mcp_server},
		{"workflow", apiresourcekind.ApiResourceKind_workflow},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseKinds([]string{tt.input})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("len = %d, want 1", len(got))
			}
			if got[0] != tt.want {
				t.Errorf("parseKinds(%q) = %v, want %v", tt.input, got[0], tt.want)
			}
		})
	}
}

func TestParseKinds_multipleValid(t *testing.T) {
	input := []string{"agent", "skill", "workflow"}
	got, err := parseKinds(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}

	want := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_workflow,
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("got[%d] = %v, want %v", i, got[i], w)
		}
	}
}

func TestParseKinds_invalid(t *testing.T) {
	_, err := parseKinds([]string{"bogus"})
	if err == nil {
		t.Fatal("expected error for unknown kind, got nil")
	}
}

func TestParseKinds_mixedValidAndInvalid(t *testing.T) {
	_, err := parseKinds([]string{"agent", "nonexistent"})
	if err == nil {
		t.Fatal("expected error when mix contains invalid kind, got nil")
	}
}

func TestTool_metadata(t *testing.T) {
	tool := Tool()
	if tool.Name != "search" {
		t.Errorf("Name = %q, want %q", tool.Name, "search")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

// ---------------------------------------------------------------------------
// enrichSearchResponse unit tests
// ---------------------------------------------------------------------------

func TestEnrichSearchResponse_mixedKinds(t *testing.T) {
	resp := &searchv1.SearchResponse{
		Entries: []*searchv1.SearchResult{
			{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Org:  "acme",
				Slug: "code-reviewer",
				Name: "Code Reviewer",
			},
			{
				Kind: apiresourcekind.ApiResourceKind_skill,
				Org:  "acme",
				Slug: "deploy-k8s",
				Name: "Deploy K8s",
			},
			{
				Kind: apiresourcekind.ApiResourceKind_workflow,
				Org:  "acme",
				Slug: "ci-pipeline",
				Name: "CI Pipeline",
			},
			{
				Kind: apiresourcekind.ApiResourceKind_mcp_server,
				Org:  "acme",
				Slug: "my-server",
				Name: "My Server",
			},
		},
		TotalCount: 4,
		TotalPages: 1,
	}

	text, err := enrichSearchResponse(resp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}

	entries, ok := data["entries"].([]any)
	if !ok {
		t.Fatal("entries is not an array")
	}
	if len(entries) != 4 {
		t.Fatalf("len(entries) = %d, want 4", len(entries))
	}

	wantURIs := []string{
		"stigmer://agents/acme/code-reviewer",
		"stigmer://skills/acme/deploy-k8s",
		"stigmer://workflows/acme/ci-pipeline",
		"stigmer://mcp-servers/acme/my-server",
	}

	for i, e := range entries {
		entry := e.(map[string]any)
		uri, _ := entry["resource_uri"].(string)
		if uri != wantURIs[i] {
			t.Errorf("entries[%d].resource_uri = %q, want %q", i, uri, wantURIs[i])
		}
	}
}

func TestEnrichSearchResponse_emptyEntries(t *testing.T) {
	resp := &searchv1.SearchResponse{
		TotalCount: 0,
		TotalPages: 0,
	}

	text, err := enrichSearchResponse(resp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
}

// ---------------------------------------------------------------------------
// Integration tests — mock gRPC server
// ---------------------------------------------------------------------------

type mockSearchService struct {
	searchv1.UnimplementedSearchServiceServer
	gotReq *searchv1.SearchRequest
	resp   *searchv1.SearchResponse
	err    error
}

func (m *mockSearchService) Search(_ context.Context, req *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	m.gotReq = req
	return m.resp, m.err
}

func TestHandler_success(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{
			Entries: []*searchv1.SearchResult{
				{
					Kind: apiresourcekind.ApiResourceKind_agent,
					Org:  "acme",
					Slug: "code-reviewer",
					Name: "Code Reviewer",
				},
			},
			TotalCount: 1,
			TotalPages: 1,
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	result, _, err := handler(ctx, nil, &SearchInput{
		Kinds: []string{"agent"},
		Query: "kubernetes",
		Org:   "acme",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotReq == nil {
		t.Fatal("mock never received a request")
	}
	if len(mock.gotReq.Kinds) != 1 || mock.gotReq.Kinds[0] != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("Kinds = %v, want [agent]", mock.gotReq.Kinds)
	}
	if mock.gotReq.Query != "kubernetes" {
		t.Errorf("Query = %q, want %q", mock.gotReq.Query, "kubernetes")
	}
	if mock.gotReq.Org != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotReq.Org, "acme")
	}

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}

	entries, ok := raw["entries"].([]any)
	if !ok || len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %v", raw["entries"])
	}
	entry := entries[0].(map[string]any)
	uri, _ := entry["resource_uri"].(string)
	if uri != "stigmer://agents/acme/code-reviewer" {
		t.Errorf("resource_uri = %q, want %q", uri, "stigmer://agents/acme/code-reviewer")
	}
}

func TestHandler_pagination(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{TotalCount: 50, TotalPages: 3},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{
		PageSize: 20,
		PageNum:  2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotReq.Page == nil {
		t.Fatal("expected Page to be set on gRPC request")
	}
	if mock.gotReq.Page.Size != 20 {
		t.Errorf("Page.Size = %d, want 20", mock.gotReq.Page.Size)
	}
	if mock.gotReq.Page.Num != 2 {
		t.Errorf("Page.Num = %d, want 2", mock.gotReq.Page.Num)
	}
}

func TestHandler_noPaginationWhenZero(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotReq.Page != nil {
		t.Errorf("expected Page to be nil when no pagination params set, got %+v", mock.gotReq.Page)
	}
}

func TestHandler_excludePublic(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{ExcludePublic: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !mock.gotReq.ExcludePublic {
		t.Error("ExcludePublic = false on gRPC request, want true")
	}
}

func TestHandler_missingAPIKey(t *testing.T) {
	handler := Handler("localhost:0")

	_, _, err := handler(context.Background(), nil, &SearchInput{})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestHandler_invalidKind(t *testing.T) {
	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, &mockSearchService{
			resp: &searchv1.SearchResponse{},
		})
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{Kinds: []string{"invalid_kind"}})
	if err == nil {
		t.Fatal("expected error for invalid kind, got nil")
	}
}

func TestHandler_grpcError(t *testing.T) {
	mock := &mockSearchService{
		err: status.Error(codes.Internal, "database unreachable"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{})
	if err == nil {
		t.Fatal("expected error when gRPC returns error, got nil")
	}
}

func TestHandler_grpcErrorWithOrg(t *testing.T) {
	mock := &mockSearchService{
		err: status.Error(codes.NotFound, "no results"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{Org: "acme"})
	if err == nil {
		t.Fatal("expected error when gRPC returns error with org set, got nil")
	}
	if !strings.Contains(err.Error(), "acme") {
		t.Errorf("error = %q, want it to mention org %q", err.Error(), "acme")
	}
}

func TestHandler_multipleKinds(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{
		Kinds: []string{"agent", "skill", "workflow"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(mock.gotReq.Kinds) != 3 {
		t.Fatalf("len(Kinds) = %d, want 3", len(mock.gotReq.Kinds))
	}
	want := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_workflow,
	}
	for i, w := range want {
		if mock.gotReq.Kinds[i] != w {
			t.Errorf("Kinds[%d] = %v, want %v", i, mock.gotReq.Kinds[i], w)
		}
	}
}

// Verify pagination is set even when only PageSize is specified.
func TestHandler_pageSizeOnly(t *testing.T) {
	mock := &mockSearchService{
		resp: &searchv1.SearchResponse{},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		searchv1.RegisterSearchServiceServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &SearchInput{PageSize: 50})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotReq.Page == nil {
		t.Fatal("expected Page to be set when PageSize > 0")
	}
	if mock.gotReq.Page.Size != 50 {
		t.Errorf("Page.Size = %d, want 50", mock.gotReq.Page.Size)
	}
}

// extractText pulls the text string from the first TextContent in a CallToolResult.
func extractText(t *testing.T, result *mcp.CallToolResult) string {
	t.Helper()
	if result == nil {
		t.Fatal("result is nil")
	}
	if len(result.Content) == 0 {
		t.Fatal("result has no content")
	}
	tc, ok := result.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content[0] is %T, want *mcp.TextContent", result.Content[0])
	}
	return tc.Text
}

// Silence the unused import linter for rpcpb — it is used transitively through
// the mock but the compiler needs to see it referenced.
var _ = rpcpb.PageInfo{}

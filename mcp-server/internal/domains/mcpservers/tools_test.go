package mcpservers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockMcpServerQueryController struct {
	mcpserverv1.UnimplementedMcpServerQueryControllerServer
	gotRef *apiresource.ApiResourceReference
	resp   *mcpserverv1.McpServer
	err    error
}

func (m *mockMcpServerQueryController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*mcpserverv1.McpServer, error) {
	m.gotRef = ref
	return m.resp, m.err
}

func TestTool_metadata(t *testing.T) {
	tool := Tool()
	if tool.Name != "get_mcp_server" {
		t.Errorf("Name = %q, want %q", tool.Name, "get_mcp_server")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestHandler_success(t *testing.T) {
	mock := &mockMcpServerQueryController{
		resp: &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	result, _, err := handler(ctx, nil, &GetMcpServerInput{Org: "acme", Slug: "my-server"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotRef == nil {
		t.Fatal("mock never received a request")
	}
	if mock.gotRef.Org != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotRef.Org, "acme")
	}
	if mock.gotRef.Slug != "my-server" {
		t.Errorf("Slug = %q, want %q", mock.gotRef.Slug, "my-server")
	}
	if mock.gotRef.Kind != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("Kind = %v, want mcp_server", mock.gotRef.Kind)
	}

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
	if raw["kind"] != "McpServer" {
		t.Errorf("kind = %v, want %q", raw["kind"], "McpServer")
	}
}

func TestHandler_missingAPIKey(t *testing.T) {
	handler := Handler("localhost:0")

	_, _, err := handler(context.Background(), nil, &GetMcpServerInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestHandler_grpcNotFound(t *testing.T) {
	mock := &mockMcpServerQueryController{
		err: status.Error(codes.NotFound, "mcp server not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &GetMcpServerInput{Org: "acme", Slug: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

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

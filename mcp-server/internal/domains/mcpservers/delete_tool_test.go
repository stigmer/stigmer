package mcpservers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockMcpServerDeleteController implements both Query and Command servers for
// testing the fetch-then-delete flow end-to-end.
type mockMcpServerDeleteController struct {
	mcpserverv1.UnimplementedMcpServerQueryControllerServer
	mcpserverv1.UnimplementedMcpServerCommandControllerServer

	queryResp *mcpserverv1.McpServer
	queryErr  error

	gotDeleteID string
	deleteResp  *mcpserverv1.McpServer
	deleteErr   error
}

func (m *mockMcpServerDeleteController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*mcpserverv1.McpServer, error) {
	return m.queryResp, m.queryErr
}

func (m *mockMcpServerDeleteController) Delete(_ context.Context, input *apiresource.ApiResourceDeleteInput) (*mcpserverv1.McpServer, error) {
	m.gotDeleteID = input.GetResourceId()
	return m.deleteResp, m.deleteErr
}

func TestDeleteTool_metadata(t *testing.T) {
	tool := DeleteTool()
	if tool.Name != "delete_mcp_server" {
		t.Errorf("Name = %q, want %q", tool.Name, "delete_mcp_server")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestDeleteHandler_success(t *testing.T) {
	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Org:  "acme",
			Slug: "github",
			Name: "GitHub",
			Id:   "mcp-id-456",
		},
	}

	mock := &mockMcpServerDeleteController{
		queryResp:  server,
		deleteResp: server,
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
		mcpserverv1.RegisterMcpServerCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	result, _, err := handler(ctx, nil, &DeleteMcpServerInput{Org: "acme", Slug: "github"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotDeleteID != "mcp-id-456" {
		t.Errorf("delete was called with ID %q, want %q", mock.gotDeleteID, "mcp-id-456")
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

func TestDeleteHandler_notFound(t *testing.T) {
	mock := &mockMcpServerDeleteController{
		queryErr: status.Error(codes.NotFound, "mcp server not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
		mcpserverv1.RegisterMcpServerCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteMcpServerInput{Org: "acme", Slug: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

func TestDeleteHandler_deletePermissionDenied(t *testing.T) {
	server := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Id: "mcp-id-789"},
	}

	mock := &mockMcpServerDeleteController{
		queryResp: server,
		deleteErr: status.Error(codes.PermissionDenied, "unauthorized to delete"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
		mcpserverv1.RegisterMcpServerCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteMcpServerInput{Org: "acme", Slug: "restricted"})
	if err == nil {
		t.Fatal("expected error for PermissionDenied on delete, got nil")
	}
}

func TestDeleteHandler_missingAPIKey(t *testing.T) {
	handler := DeleteHandler("localhost:0")

	_, _, err := handler(context.Background(), nil, &DeleteMcpServerInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

package mcpservers

import (
	"context"
	"encoding/json"
	"testing"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/agentic/mcpserver"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockMcpServerCommandController struct {
	mcpserverv1.UnimplementedMcpServerCommandControllerServer
	gotServer *mcpserverv1.McpServer
	resp      *mcpserverv1.McpServer
	err       error
}

func (m *mockMcpServerCommandController) Apply(_ context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.gotServer = server
	return m.resp, m.err
}

func TestApplyTool_metadata(t *testing.T) {
	tool := ApplyTool()
	if tool.Name != "apply_mcp_server" {
		t.Errorf("Name = %q, want %q", tool.Name, "apply_mcp_server")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestApplyHandler_success(t *testing.T) {
	mock := &mockMcpServerCommandController{
		resp: &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Org:  "acme",
				Slug: "github",
				Name: "GitHub",
				Id:   "mcp_123",
			},
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &geninput.McpServerInput{
		Description: "GitHub MCP server",
		Stdio: &geninput.StdioServerConfigInput{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		},
	}
	input.Name = "GitHub"
	input.Org = "acme"
	input.Slug = "github"

	result, _, err := handler(ctx, nil, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotServer == nil {
		t.Fatal("mock never received a request")
	}
	if mock.gotServer.GetMetadata().GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotServer.GetMetadata().GetOrg(), "acme")
	}
	if mock.gotServer.GetMetadata().GetSlug() != "github" {
		t.Errorf("Slug = %q, want %q", mock.gotServer.GetMetadata().GetSlug(), "github")
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

func TestApplyHandler_missingAPIKey(t *testing.T) {
	handler := ApplyHandler("localhost:0")

	input := &geninput.McpServerInput{
		Stdio: &geninput.StdioServerConfigInput{Command: "echo"},
	}
	input.Name = "x"
	input.Org = "acme"
	input.Slug = "x"

	_, _, err := handler(context.Background(), nil, input)
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestApplyHandler_grpcPermissionDenied(t *testing.T) {
	mock := &mockMcpServerCommandController{
		err: status.Error(codes.PermissionDenied, "unauthorized"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &geninput.McpServerInput{
		Stdio: &geninput.StdioServerConfigInput{Command: "echo"},
	}
	input.Name = "x"
	input.Org = "acme"
	input.Slug = "x"

	_, _, err := handler(ctx, nil, input)
	if err == nil {
		t.Fatal("expected error for PermissionDenied, got nil")
	}
}

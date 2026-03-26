package mcpservers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTemplate_metadata(t *testing.T) {
	tmpl := Template()
	if tmpl.URITemplate != "stigmer://mcp-servers/{org}/{slug}" {
		t.Errorf("URITemplate = %q, want stigmer://mcp-servers/{org}/{slug}", tmpl.URITemplate)
	}
	if tmpl.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", tmpl.MIMEType)
	}
	if tmpl.Name == "" {
		t.Error("Name is empty")
	}
}

func TestResourceHandler_success(t *testing.T) {
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
	handler := ResourceHandler(addr)

	result, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://mcp-servers/acme/my-server"},
	})
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

	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	rc := result.Contents[0]
	if rc.URI != "stigmer://mcp-servers/acme/my-server" {
		t.Errorf("URI = %q, want original request URI", rc.URI)
	}
	if rc.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", rc.MIMEType)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(rc.Text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, rc.Text)
	}
	if raw["kind"] != "McpServer" {
		t.Errorf("kind = %v, want %q", raw["kind"], "McpServer")
	}
}

func TestResourceHandler_malformedURI(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://mcp-servers/acme"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
}

func TestResourceHandler_missingAPIKey(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://mcp-servers/acme/my-server"},
	})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestResourceHandler_grpcNotFound(t *testing.T) {
	mock := &mockMcpServerQueryController{
		err: status.Error(codes.NotFound, "mcp server not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		mcpserverv1.RegisterMcpServerQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ResourceHandler(addr)

	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://mcp-servers/acme/nonexistent"},
	})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

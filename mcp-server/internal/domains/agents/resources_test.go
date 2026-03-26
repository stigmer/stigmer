package agents

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	agentv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTemplate_metadata(t *testing.T) {
	tmpl := Template()
	if tmpl.URITemplate != "stigmer://agents/{org}/{slug}" {
		t.Errorf("URITemplate = %q, want stigmer://agents/{org}/{slug}", tmpl.URITemplate)
	}
	if tmpl.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", tmpl.MIMEType)
	}
	if tmpl.Name == "" {
		t.Error("Name is empty")
	}
}

func TestResourceHandler_success(t *testing.T) {
	mock := &mockAgentQueryController{
		resp: &agentv1.Agent{
			ApiVersion: "agentic/v1",
			Kind:       "agent",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		agentv1.RegisterAgentQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ResourceHandler(addr)

	result, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme/code-reviewer"},
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
	if mock.gotRef.Slug != "code-reviewer" {
		t.Errorf("Slug = %q, want %q", mock.gotRef.Slug, "code-reviewer")
	}
	if mock.gotRef.Kind != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("Kind = %v, want agent", mock.gotRef.Kind)
	}

	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	rc := result.Contents[0]
	if rc.URI != "stigmer://agents/acme/code-reviewer" {
		t.Errorf("URI = %q, want original request URI", rc.URI)
	}
	if rc.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", rc.MIMEType)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(rc.Text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, rc.Text)
	}
	if raw["api_version"] != "agentic/v1" {
		t.Errorf("api_version = %v, want %q", raw["api_version"], "agentic/v1")
	}
}

func TestResourceHandler_malformedURI(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
}

func TestResourceHandler_missingAPIKey(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme/code-reviewer"},
	})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestResourceHandler_grpcNotFound(t *testing.T) {
	mock := &mockAgentQueryController{
		err: status.Error(codes.NotFound, "agent not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		agentv1.RegisterAgentQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ResourceHandler(addr)

	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme/nonexistent"},
	})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

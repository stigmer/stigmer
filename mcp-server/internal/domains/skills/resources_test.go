package skills

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	skillv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTemplate_metadata(t *testing.T) {
	tmpl := Template()
	if tmpl.URITemplate != "stigmer://skills/{org}/{slug}" {
		t.Errorf("URITemplate = %q, want stigmer://skills/{org}/{slug}", tmpl.URITemplate)
	}
	if tmpl.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", tmpl.MIMEType)
	}
	if tmpl.Name == "" {
		t.Error("Name is empty")
	}
}

func TestResourceHandler_success(t *testing.T) {
	mock := &mockSkillQueryController{
		resp: &skillv1.Skill{
			ApiVersion: "agentic/v1",
			Kind:       "skill",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ResourceHandler(addr)

	result, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/deploy-k8s"},
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
	if mock.gotRef.Slug != "deploy-k8s" {
		t.Errorf("Slug = %q, want %q", mock.gotRef.Slug, "deploy-k8s")
	}
	if mock.gotRef.Kind != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("Kind = %v, want skill", mock.gotRef.Kind)
	}
	if mock.gotRef.Version != "" {
		t.Errorf("Version = %q, want empty (latest)", mock.gotRef.Version)
	}

	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	rc := result.Contents[0]
	if rc.URI != "stigmer://skills/acme/deploy-k8s" {
		t.Errorf("URI = %q, want original request URI", rc.URI)
	}
	if rc.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", rc.MIMEType)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(rc.Text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, rc.Text)
	}
	if raw["kind"] != "skill" {
		t.Errorf("kind = %v, want %q", raw["kind"], "skill")
	}
}

func TestResourceHandler_malformedURI(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
}

func TestResourceHandler_missingAPIKey(t *testing.T) {
	handler := ResourceHandler("localhost:0")

	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/deploy-k8s"},
	})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestResourceHandler_grpcNotFound(t *testing.T) {
	mock := &mockSkillQueryController{
		err: status.Error(codes.NotFound, "skill not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ResourceHandler(addr)

	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/nonexistent"},
	})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

// --- Versioned resource template tests ---

func TestVersionedTemplate_metadata(t *testing.T) {
	tmpl := VersionedTemplate()
	if tmpl.URITemplate != "stigmer://skills/{org}/{slug}/{version}" {
		t.Errorf("URITemplate = %q, want stigmer://skills/{org}/{slug}/{version}", tmpl.URITemplate)
	}
	if tmpl.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", tmpl.MIMEType)
	}
	if tmpl.Name == "" {
		t.Error("Name is empty")
	}
	if tmpl.Name == Template().Name {
		t.Errorf("versioned template Name %q must differ from the latest template Name", tmpl.Name)
	}
}

func TestVersionedResourceHandler_success(t *testing.T) {
	mock := &mockSkillQueryController{
		resp: &skillv1.Skill{
			ApiVersion: "agentic/v1",
			Kind:       "skill",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := VersionedResourceHandler(addr)

	result, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/deploy-k8s/stable"},
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
	if mock.gotRef.Slug != "deploy-k8s" {
		t.Errorf("Slug = %q, want %q", mock.gotRef.Slug, "deploy-k8s")
	}
	if mock.gotRef.Kind != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("Kind = %v, want skill", mock.gotRef.Kind)
	}
	if mock.gotRef.Version != "stable" {
		t.Errorf("Version = %q, want %q", mock.gotRef.Version, "stable")
	}

	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	rc := result.Contents[0]
	if rc.URI != "stigmer://skills/acme/deploy-k8s/stable" {
		t.Errorf("URI = %q, want original request URI", rc.URI)
	}
	if rc.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want application/json", rc.MIMEType)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(rc.Text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, rc.Text)
	}
	if raw["kind"] != "skill" {
		t.Errorf("kind = %v, want %q", raw["kind"], "skill")
	}
}

func TestVersionedResourceHandler_latestFallback(t *testing.T) {
	mock := &mockSkillQueryController{
		resp: &skillv1.Skill{
			ApiVersion: "agentic/v1",
			Kind:       "skill",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := VersionedResourceHandler(addr)

	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/deploy-k8s"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotRef.Version != "" {
		t.Errorf("Version = %q, want empty (latest fallback)", mock.gotRef.Version)
	}
}

func TestVersionedResourceHandler_malformedURI(t *testing.T) {
	handler := VersionedResourceHandler("localhost:0")

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
}

func TestVersionedResourceHandler_grpcNotFound(t *testing.T) {
	mock := &mockSkillQueryController{
		err: status.Error(codes.NotFound, "skill version not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := VersionedResourceHandler(addr)

	_, err := handler(ctx, &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/deploy-k8s/nonexistent-tag"},
	})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

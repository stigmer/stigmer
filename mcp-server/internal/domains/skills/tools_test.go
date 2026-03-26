package skills

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	skillv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockSkillQueryController struct {
	skillv1.UnimplementedSkillQueryControllerServer
	gotRef *apiresource.ApiResourceReference
	resp   *skillv1.Skill
	err    error
}

func (m *mockSkillQueryController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*skillv1.Skill, error) {
	m.gotRef = ref
	return m.resp, m.err
}

func TestTool_metadata(t *testing.T) {
	tool := Tool()
	if tool.Name != "get_skill" {
		t.Errorf("Name = %q, want %q", tool.Name, "get_skill")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestHandler_success(t *testing.T) {
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
	handler := Handler(addr)

	result, _, err := handler(ctx, nil, &GetSkillInput{Org: "acme", Slug: "deploy-k8s"})
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

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
	if raw["kind"] != "skill" {
		t.Errorf("kind = %v, want %q", raw["kind"], "skill")
	}
}

func TestHandler_withVersion(t *testing.T) {
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
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &GetSkillInput{
		Org:     "acme",
		Slug:    "deploy-k8s",
		Version: "stable",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotRef.Version != "stable" {
		t.Errorf("Version = %q, want %q", mock.gotRef.Version, "stable")
	}
}

func TestHandler_missingAPIKey(t *testing.T) {
	handler := Handler("localhost:0")

	_, _, err := handler(context.Background(), nil, &GetSkillInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestHandler_grpcNotFound(t *testing.T) {
	mock := &mockSkillQueryController{
		err: status.Error(codes.NotFound, "skill not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &GetSkillInput{Org: "acme", Slug: "nonexistent"})
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

package skills

import (
	"context"
	"encoding/json"
	"testing"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockSkillDeleteController implements both Query and Command servers for
// testing the fetch-then-delete flow end-to-end.
type mockSkillDeleteController struct {
	skillv1.UnimplementedSkillQueryControllerServer
	skillv1.UnimplementedSkillCommandControllerServer

	queryResp *skillv1.Skill
	queryErr  error

	gotDeleteID string
	deleteResp  *skillv1.Skill
	deleteErr   error
}

func (m *mockSkillDeleteController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*skillv1.Skill, error) {
	return m.queryResp, m.queryErr
}

func (m *mockSkillDeleteController) Delete(_ context.Context, id *skillv1.SkillId) (*skillv1.Skill, error) {
	m.gotDeleteID = id.GetValue()
	return m.deleteResp, m.deleteErr
}

func TestDeleteTool_metadata(t *testing.T) {
	tool := DeleteTool()
	if tool.Name != "delete_skill" {
		t.Errorf("Name = %q, want %q", tool.Name, "delete_skill")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestDeleteHandler_success(t *testing.T) {
	skill := &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Org:  "acme",
			Slug: "code-review",
			Name: "Code Review",
			Id:   "skill-id-456",
		},
	}

	mock := &mockSkillDeleteController{
		queryResp:  skill,
		deleteResp: skill,
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
		skillv1.RegisterSkillCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	result, _, err := handler(ctx, nil, &DeleteSkillInput{Org: "acme", Slug: "code-review"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotDeleteID != "skill-id-456" {
		t.Errorf("delete was called with ID %q, want %q", mock.gotDeleteID, "skill-id-456")
	}

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
	if raw["api_version"] != "agentic.stigmer.ai/v1" {
		t.Errorf("api_version = %v, want %q", raw["api_version"], "agentic.stigmer.ai/v1")
	}
}

func TestDeleteHandler_notFound(t *testing.T) {
	mock := &mockSkillDeleteController{
		queryErr: status.Error(codes.NotFound, "skill not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
		skillv1.RegisterSkillCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteSkillInput{Org: "acme", Slug: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

func TestDeleteHandler_deletePermissionDenied(t *testing.T) {
	skill := &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{Id: "skill-id-789"},
	}

	mock := &mockSkillDeleteController{
		queryResp: skill,
		deleteErr: status.Error(codes.PermissionDenied, "unauthorized to delete"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		skillv1.RegisterSkillQueryControllerServer(s, mock)
		skillv1.RegisterSkillCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteSkillInput{Org: "acme", Slug: "restricted"})
	if err == nil {
		t.Fatal("expected error for PermissionDenied on delete, got nil")
	}
}

func TestDeleteHandler_missingAPIKey(t *testing.T) {
	handler := DeleteHandler("localhost:0")

	_, _, err := handler(context.Background(), nil, &DeleteSkillInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

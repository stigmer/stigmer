package workflows

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockWorkflowQueryController struct {
	workflowv1.UnimplementedWorkflowQueryControllerServer
	gotRef *apiresource.ApiResourceReference
	resp   *workflowv1.Workflow
	err    error
}

func (m *mockWorkflowQueryController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*workflowv1.Workflow, error) {
	m.gotRef = ref
	return m.resp, m.err
}

func TestTool_metadata(t *testing.T) {
	tool := Tool()
	if tool.Name != "get_workflow" {
		t.Errorf("Name = %q, want %q", tool.Name, "get_workflow")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestHandler_success(t *testing.T) {
	mock := &mockWorkflowQueryController{
		resp: &workflowv1.Workflow{
			ApiVersion: "agentic/v1",
			Kind:       "workflow",
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	result, _, err := handler(ctx, nil, &GetWorkflowInput{Org: "acme", Slug: "ci-pipeline"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotRef == nil {
		t.Fatal("mock never received a request")
	}
	if mock.gotRef.Org != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotRef.Org, "acme")
	}
	if mock.gotRef.Slug != "ci-pipeline" {
		t.Errorf("Slug = %q, want %q", mock.gotRef.Slug, "ci-pipeline")
	}
	if mock.gotRef.Kind != apiresourcekind.ApiResourceKind_workflow {
		t.Errorf("Kind = %v, want workflow", mock.gotRef.Kind)
	}

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
	if raw["kind"] != "workflow" {
		t.Errorf("kind = %v, want %q", raw["kind"], "workflow")
	}
}

func TestHandler_missingAPIKey(t *testing.T) {
	handler := Handler("localhost:0")

	_, _, err := handler(context.Background(), nil, &GetWorkflowInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestHandler_grpcNotFound(t *testing.T) {
	mock := &mockWorkflowQueryController{
		err: status.Error(codes.NotFound, "workflow not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowQueryControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := Handler(addr)

	_, _, err := handler(ctx, nil, &GetWorkflowInput{Org: "acme", Slug: "nonexistent"})
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

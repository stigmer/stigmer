package workflows

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockWorkflowDeleteController implements both Query and Command servers for
// testing the fetch-then-delete flow end-to-end.
type mockWorkflowDeleteController struct {
	workflowv1.UnimplementedWorkflowQueryControllerServer
	workflowv1.UnimplementedWorkflowCommandControllerServer

	queryResp *workflowv1.Workflow
	queryErr  error

	gotDeleteID string
	deleteResp  *workflowv1.Workflow
	deleteErr   error
}

func (m *mockWorkflowDeleteController) GetByReference(_ context.Context, ref *apiresource.ApiResourceReference) (*workflowv1.Workflow, error) {
	return m.queryResp, m.queryErr
}

func (m *mockWorkflowDeleteController) Delete(_ context.Context, id *workflowv1.WorkflowId) (*workflowv1.Workflow, error) {
	m.gotDeleteID = id.GetValue()
	return m.deleteResp, m.deleteErr
}

func TestDeleteTool_metadata(t *testing.T) {
	tool := DeleteTool()
	if tool.Name != "delete_workflow" {
		t.Errorf("Name = %q, want %q", tool.Name, "delete_workflow")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestDeleteHandler_success(t *testing.T) {
	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Org:  "acme",
			Slug: "ci-pipeline",
			Name: "CI Pipeline",
			Id:   "wf-id-456",
		},
	}

	mock := &mockWorkflowDeleteController{
		queryResp:  wf,
		deleteResp: wf,
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowQueryControllerServer(s, mock)
		workflowv1.RegisterWorkflowCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	result, _, err := handler(ctx, nil, &DeleteWorkflowInput{Org: "acme", Slug: "ci-pipeline"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotDeleteID != "wf-id-456" {
		t.Errorf("delete was called with ID %q, want %q", mock.gotDeleteID, "wf-id-456")
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
	mock := &mockWorkflowDeleteController{
		queryErr: status.Error(codes.NotFound, "workflow not found"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowQueryControllerServer(s, mock)
		workflowv1.RegisterWorkflowCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteWorkflowInput{Org: "acme", Slug: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for NotFound, got nil")
	}
}

func TestDeleteHandler_deletePermissionDenied(t *testing.T) {
	wf := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wf-id-789"},
	}

	mock := &mockWorkflowDeleteController{
		queryResp: wf,
		deleteErr: status.Error(codes.PermissionDenied, "unauthorized to delete"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowQueryControllerServer(s, mock)
		workflowv1.RegisterWorkflowCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := DeleteHandler(addr)

	_, _, err := handler(ctx, nil, &DeleteWorkflowInput{Org: "acme", Slug: "restricted"})
	if err == nil {
		t.Fatal("expected error for PermissionDenied on delete, got nil")
	}
}

func TestDeleteHandler_missingAPIKey(t *testing.T) {
	handler := DeleteHandler("localhost:0")

	_, _, err := handler(context.Background(), nil, &DeleteWorkflowInput{Org: "acme", Slug: "x"})
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

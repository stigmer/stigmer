package workflows

import (
	"context"
	"encoding/json"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockWorkflowCommandController struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	gotWorkflow *workflowv1.Workflow
	resp        *workflowv1.Workflow
	err         error
}

func (m *mockWorkflowCommandController) Apply(_ context.Context, wf *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.gotWorkflow = wf
	return m.resp, m.err
}

func TestApplyTool_metadata(t *testing.T) {
	tool := ApplyTool()
	if tool.Name != "apply_workflow" {
		t.Errorf("Name = %q, want %q", tool.Name, "apply_workflow")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestApplyHandler_success(t *testing.T) {
	mock := &mockWorkflowCommandController{
		resp: &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Org:  "acme",
				Slug: "ci-pipeline",
				Name: "CI Pipeline",
				Id:   "wf-123",
			},
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &ApplyWorkflowInput{
		Resource: `{
			"api_version": "agentic.stigmer.ai/v1",
			"kind": "Workflow",
			"metadata": {"org": "acme", "slug": "ci-pipeline", "name": "CI Pipeline"},
			"spec": {"description": "A CI pipeline workflow"}
		}`,
	}

	result, _, err := handler(ctx, nil, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotWorkflow == nil {
		t.Fatal("mock never received a request")
	}
	if mock.gotWorkflow.GetMetadata().GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotWorkflow.GetMetadata().GetOrg(), "acme")
	}
	if mock.gotWorkflow.GetMetadata().GetSlug() != "ci-pipeline" {
		t.Errorf("Slug = %q, want %q", mock.gotWorkflow.GetMetadata().GetSlug(), "ci-pipeline")
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

func TestApplyHandler_invalidJSON(t *testing.T) {
	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler("localhost:0")

	_, _, err := handler(ctx, nil, &ApplyWorkflowInput{Resource: "{not valid"})
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestApplyHandler_missingAPIKey(t *testing.T) {
	handler := ApplyHandler("localhost:0")

	input := &ApplyWorkflowInput{
		Resource: `{"api_version": "agentic.stigmer.ai/v1", "kind": "Workflow", "metadata": {"org": "acme", "slug": "x"}}`,
	}
	_, _, err := handler(context.Background(), nil, input)
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestApplyHandler_grpcPermissionDenied(t *testing.T) {
	mock := &mockWorkflowCommandController{
		err: status.Error(codes.PermissionDenied, "unauthorized"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		workflowv1.RegisterWorkflowCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &ApplyWorkflowInput{
		Resource: `{"api_version": "agentic.stigmer.ai/v1", "kind": "Workflow", "metadata": {"org": "acme", "slug": "x"}}`,
	}
	_, _, err := handler(ctx, nil, input)
	if err == nil {
		t.Fatal("expected error for PermissionDenied, got nil")
	}
}

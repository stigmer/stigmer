package workflows

import (
	"context"
	"encoding/json"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	geninput "github.com/stigmer/stigmer/mcp-server/gen/workflow"
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

func newTestInput() *geninput.WorkflowInput {
	input := &geninput.WorkflowInput{
		Description: "A CI pipeline workflow",
		Document: &geninput.WorkflowDocumentInput{
			Dsl:       "1.0.0",
			Namespace: "acme",
			Name:      "ci-pipeline",
			Version:   "1.0.0",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{
				Name: "fetch-data",
				Kind: "http_call",
				HttpCall: &geninput.HttpCallTaskConfigInput{
					Method:   "GET",
					Endpoint: &geninput.HttpEndpointInput{Uri: "https://example.com"},
				},
			},
		},
	}
	input.Name = "CI Pipeline"
	input.Slug = "ci-pipeline"
	input.Org = "acme"
	return input
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

	input := newTestInput()

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
	if mock.gotWorkflow.GetSpec().GetDescription() != "A CI pipeline workflow" {
		t.Errorf("Description = %q, want %q", mock.gotWorkflow.GetSpec().GetDescription(), "A CI pipeline workflow")
	}
	if len(mock.gotWorkflow.GetSpec().GetTasks()) != 1 {
		t.Fatalf("Tasks length = %d, want 1", len(mock.gotWorkflow.GetSpec().GetTasks()))
	}

	task := mock.gotWorkflow.GetSpec().GetTasks()[0]
	if task.GetName() != "fetch-data" {
		t.Errorf("Task.Name = %q, want %q", task.GetName(), "fetch-data")
	}
	if task.GetKind() != workflowv1.WorkflowTaskKind_http_call {
		t.Errorf("Task.Kind = %v, want http_call", task.GetKind())
	}
	if task.GetTaskConfig() == nil {
		t.Fatal("Task.TaskConfig is nil")
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

func TestApplyHandler_missingAPIKey(t *testing.T) {
	handler := ApplyHandler("localhost:0")

	input := newTestInput()
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

	input := newTestInput()
	_, _, err := handler(ctx, nil, input)
	if err == nil {
		t.Fatal("expected error for PermissionDenied, got nil")
	}
}

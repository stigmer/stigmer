package workflow

import (
	"context"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// stubWorkflowValidator satisfies validation.WorkflowValidator. The nil-spec
// guard returns before validation runs, so this stub is never invoked there; it
// only needs to be non-nil so the step does not short-circuit as "validator
// unavailable".
type stubWorkflowValidator struct{}

func (stubWorkflowValidator) Validate(ctx context.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error) {
	return &serverlessv1.ServerlessWorkflowValidation{State: serverlessv1.ValidationState_VALID}, nil
}

func TestValidateWorkflowSpecStep_NilSpecReturnsInvalidArgument(t *testing.T) {
	step := newValidateWorkflowSpecStep(stubWorkflowValidator{})

	// Workflow.spec is not proto-required, so a spec-less create reaches this
	// step; it must be rejected as InvalidArgument (not Unknown).
	wf := &workflowv1.Workflow{}

	err := step.Execute(pipeline.NewRequestContext(context.Background(), wf))

	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

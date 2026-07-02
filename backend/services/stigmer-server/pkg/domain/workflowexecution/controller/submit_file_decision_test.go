package workflowexecution

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// fakeFileDecisionClient captures the forwarded input and returns a configurable outcome.
type fakeFileDecisionClient struct {
	captured *agentexecutionv1.SubmitFileDecisionInput
	result   *agentexecutionv1.AgentExecution
	err      error
	calls    int
}

func (f *fakeFileDecisionClient) SubmitFileDecision(ctx context.Context, input *agentexecutionv1.SubmitFileDecisionInput) (*agentexecutionv1.AgentExecution, error) {
	f.calls++
	f.captured = input
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

func seedWorkflowExecutionWithFileReviews(t *testing.T, s store.Store, id string, frs ...*workflowexecutionv1.WorkflowPendingFileReview) {
	t.Helper()
	we := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: "wf-exec", Org: "test-org"},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase:              workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			PendingFileReviews: frs,
		},
	}
	require.NoError(t, s.SaveResource(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution, id, we))
}

func validFileDecisionInput(execID, childID, changeSetID string) *workflowexecutionv1.SubmitWorkflowFileDecisionInput {
	return &workflowexecutionv1.SubmitWorkflowFileDecisionInput{
		ExecutionId:           execID,
		ChildAgentExecutionId: childID,
		ChangeSetId:           changeSetID,
		Scope:                 agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:                agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:        "sha256:deadbeef",
	}
}

func TestSubmitFileDecision_ForwardHappyPath(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	seedWorkflowExecutionWithFileReviews(t, s, "wfx_1",
		&workflowexecutionv1.WorkflowPendingFileReview{ChildAgentExecutionId: "aex_child", ChangeSetId: []string{"fcs_1", "fcs_2"}},
	)
	fake := &fakeFileDecisionClient{result: &agentexecutionv1.AgentExecution{Metadata: &apiresource.ApiResourceMetadata{Id: "aex_child"}}}
	controller.SetAgentExecutionFileDecisionClient(fake)

	in := validFileDecisionInput("wfx_1", "aex_child", "fcs_2")
	in.FileChangeId = "fc_9"
	in.Reason = "looks good"
	in.AcknowledgeUnreviewable = true

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), in)
	require.NoError(t, err)

	require.Equal(t, 1, fake.calls, "must forward exactly once")
	require.NotNil(t, fake.captured)
	assert.Equal(t, "aex_child", fake.captured.GetAgentExecutionId(), "forwarded to the referenced child")
	assert.Equal(t, "fcs_2", fake.captured.GetChangeSetId())
	assert.Equal(t, "fc_9", fake.captured.GetFileChangeId())
	assert.Equal(t, agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET, fake.captured.GetScope())
	assert.Equal(t, agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE, fake.captured.GetAction())
	assert.Equal(t, "sha256:deadbeef", fake.captured.GetExpectedDigest(), "digest gate forwarded unchanged")
	assert.Equal(t, "looks good", fake.captured.GetReason())
	assert.True(t, fake.captured.GetAcknowledgeUnreviewable())
}

func TestSubmitFileDecision_NoPendingFileReviews(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	seedWorkflowExecutionWithFileReviews(t, s, "wfx_1") // none surfaced
	fake := &fakeFileDecisionClient{}
	controller.SetAgentExecutionFileDecisionClient(fake)

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), validFileDecisionInput("wfx_1", "aex_child", "fcs_1"))
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	assert.Equal(t, 0, fake.calls, "must not forward when nothing is surfaced")
}

func TestSubmitFileDecision_UnknownChangeSet(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	seedWorkflowExecutionWithFileReviews(t, s, "wfx_1",
		&workflowexecutionv1.WorkflowPendingFileReview{ChildAgentExecutionId: "aex_child", ChangeSetId: []string{"fcs_1"}},
	)
	fake := &fakeFileDecisionClient{}
	controller.SetAgentExecutionFileDecisionClient(fake)

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), validFileDecisionInput("wfx_1", "aex_child", "fcs_MISSING"))
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	assert.Equal(t, 0, fake.calls)
}

func TestSubmitFileDecision_WrongChild(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// Change set fcs_1 belongs to child A; a decision routed to child B for fcs_1
	// must be rejected — the (child, change_set) pair is not surfaced.
	seedWorkflowExecutionWithFileReviews(t, s, "wfx_1",
		&workflowexecutionv1.WorkflowPendingFileReview{ChildAgentExecutionId: "aex_A", ChangeSetId: []string{"fcs_1"}},
	)
	fake := &fakeFileDecisionClient{}
	controller.SetAgentExecutionFileDecisionClient(fake)

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), validFileDecisionInput("wfx_1", "aex_B", "fcs_1"))
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	assert.Equal(t, 0, fake.calls)
}

func TestSubmitFileDecision_ChildGateErrorPropagates(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	seedWorkflowExecutionWithFileReviews(t, s, "wfx_1",
		&workflowexecutionv1.WorkflowPendingFileReview{ChildAgentExecutionId: "aex_child", ChangeSetId: []string{"fcs_1"}},
	)
	// The child rejects a stale digest with INVALID_ARGUMENT; it must surface as-is,
	// not be flattened to UNAVAILABLE.
	fake := &fakeFileDecisionClient{err: grpclib.InvalidArgumentError("expected_digest mismatch")}
	controller.SetAgentExecutionFileDecisionClient(fake)

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), validFileDecisionInput("wfx_1", "aex_child", "fcs_1"))
	require.Error(t, err)
	assert.Equal(t, codes.InvalidArgument, status.Code(err), "child's gate code propagates unchanged")
	assert.Equal(t, 1, fake.calls)
}

func TestSubmitFileDecision_ExecutionNotFound(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	fake := &fakeFileDecisionClient{}
	controller.SetAgentExecutionFileDecisionClient(fake)

	_, err := controller.SubmitFileDecision(contextWithWorkflowExecutionKind(), validFileDecisionInput("wfx_missing", "aex_child", "fcs_1"))
	require.Error(t, err)
	assert.Equal(t, codes.NotFound, status.Code(err))
	assert.Equal(t, 0, fake.calls)
}

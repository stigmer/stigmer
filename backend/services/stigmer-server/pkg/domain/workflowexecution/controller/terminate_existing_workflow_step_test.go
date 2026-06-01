package workflowexecution

import (
	"context"
	"fmt"
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

// fakeTemporalClient is a minimal test fake that records TerminateWorkflow
// calls and returns configurable errors per workflow ID.
type fakeTemporalClient struct {
	client.Client
	calls  []terminateCall
	errors map[string]error
}

type terminateCall struct {
	WorkflowID string
	RunID      string
	Reason     string
}

func (f *fakeTemporalClient) TerminateWorkflow(ctx context.Context, workflowID, runID, reason string, details ...interface{}) error {
	f.calls = append(f.calls, terminateCall{WorkflowID: workflowID, RunID: runID, Reason: reason})
	if err, ok := f.errors[workflowID]; ok {
		return err
	}
	return nil
}

func newFakeTemporalClient(errors map[string]error) *fakeTemporalClient {
	return &fakeTemporalClient{errors: errors}
}

func buildTerminateStepContext(executionID string) *pipeline.RequestContext[*workflowexecutionv1.RecoverWorkflowExecutionInput] {
	input := &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "test recovery",
	}
	reqCtx := pipeline.NewRequestContext(context.Background(), input)

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: executionID},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}
	reqCtx.Set(LoadedExecutionKey, execution)

	return reqCtx
}

func expectedOrchestratorID(executionID string) string {
	return fmt.Sprintf("%s/%s", workflows.InvokeWorkflowExecutionWorkflowName, executionID)
}

func expectedChildID(executionID string) string {
	return "workflow-exec-" + executionID
}

func TestTerminateExistingWorkflow_BothTerminated(t *testing.T) {
	fake := newFakeTemporalClient(nil)
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-123")
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 2, "should terminate both orchestrator and child")
	assert.Equal(t, expectedOrchestratorID("exec-123"), fake.calls[0].WorkflowID)
	assert.Equal(t, expectedChildID("exec-123"), fake.calls[1].WorkflowID)
	assert.Equal(t, "Recovery: terminating before fresh workflow start", fake.calls[0].Reason)
	assert.Equal(t, "Recovery: terminating before fresh workflow start", fake.calls[1].Reason)
}

func TestTerminateExistingWorkflow_OrchestratorNotFound_StillTerminatesChild(t *testing.T) {
	orchestratorID := expectedOrchestratorID("exec-456")
	fake := newFakeTemporalClient(map[string]error{
		orchestratorID: serviceerror.NewNotFound("not found"),
	})
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-456")
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 2, "should still attempt child termination after orchestrator NOT_FOUND")
	assert.Equal(t, orchestratorID, fake.calls[0].WorkflowID)
	assert.Equal(t, expectedChildID("exec-456"), fake.calls[1].WorkflowID)
}

func TestTerminateExistingWorkflow_ChildNotFound_Succeeds(t *testing.T) {
	childID := expectedChildID("exec-789")
	fake := newFakeTemporalClient(map[string]error{
		childID: serviceerror.NewNotFound("not found"),
	})
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-789")
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 2)
	assert.Equal(t, expectedOrchestratorID("exec-789"), fake.calls[0].WorkflowID)
	assert.Equal(t, childID, fake.calls[1].WorkflowID)
}

func TestTerminateExistingWorkflow_BothNotFound_Succeeds(t *testing.T) {
	executionID := "exec-both-gone"
	fake := newFakeTemporalClient(map[string]error{
		expectedOrchestratorID(executionID): serviceerror.NewNotFound("not found"),
		expectedChildID(executionID):        serviceerror.NewNotFound("not found"),
	})
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext(executionID)
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 2, "should attempt both even when both are NOT_FOUND")
}

func TestTerminateExistingWorkflow_OrchestratorFails_ChildNotAttempted(t *testing.T) {
	orchestratorID := expectedOrchestratorID("exec-fail")
	fake := newFakeTemporalClient(map[string]error{
		orchestratorID: fmt.Errorf("temporal unavailable"),
	})
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-fail")
	err := step.Execute(reqCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to terminate orchestrator workflow during recovery")

	require.Len(t, fake.calls, 1, "should not attempt child if orchestrator termination fails")
	assert.Equal(t, orchestratorID, fake.calls[0].WorkflowID)
}

func TestTerminateExistingWorkflow_ChildFails_ReturnsError(t *testing.T) {
	childID := expectedChildID("exec-child-fail")
	fake := newFakeTemporalClient(map[string]error{
		childID: fmt.Errorf("temporal unavailable"),
	})
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-child-fail")
	err := step.Execute(reqCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to terminate child TS workflow during recovery")

	require.Len(t, fake.calls, 2, "should have attempted both")
}

func TestTerminateExistingWorkflow_SkipsWhenAlreadyInTargetState(t *testing.T) {
	fake := newFakeTemporalClient(nil)
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](fake)

	reqCtx := buildTerminateStepContext("exec-skip")
	reqCtx.Set("alreadyInTargetState", true)

	err := step.Execute(reqCtx)
	require.NoError(t, err)
	assert.Empty(t, fake.calls, "should not make any Temporal calls when already in target state")
}

func TestTerminateExistingWorkflow_FailsWhenTemporalClientNil(t *testing.T) {
	step := NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](nil)

	reqCtx := buildTerminateStepContext("exec-nil")
	err := step.Execute(reqCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Temporal is not available")
	assert.Empty(t, (&fakeTemporalClient{}).calls)
}

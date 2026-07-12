package agentexecution

import (
	"context"
	"fmt"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
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

func buildAgentTerminateStepContext(executionID string) *pipeline.RequestContext[*agentexecutionv1.RecoverAgentExecutionInput] {
	input := &agentexecutionv1.RecoverAgentExecutionInput{Id: executionID}
	reqCtx := pipeline.NewRequestContext(context.Background(), input)

	execution := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: executionID},
		Status:   &agentexecutionv1.AgentExecutionStatus{},
	}
	reqCtx.Set(LoadedExecutionKey, execution)

	return reqCtx
}

func expectedAgentWorkflowID(executionID string) string {
	return fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)
}

func TestTerminateExistingWorkflow_TerminatesOrchestrator(t *testing.T) {
	fake := newFakeTemporalClient(nil)
	step := NewTerminateExistingWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](fake)

	reqCtx := buildAgentTerminateStepContext("exec-123")
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 1, "agent recover terminates only the orchestrator workflow")
	assert.Equal(t, expectedAgentWorkflowID("exec-123"), fake.calls[0].WorkflowID)
	assert.Equal(t, "Recovery: terminating before fresh workflow start", fake.calls[0].Reason)
}

func TestTerminateExistingWorkflow_NotFound_Succeeds(t *testing.T) {
	workflowID := expectedAgentWorkflowID("exec-456")
	fake := newFakeTemporalClient(map[string]error{
		workflowID: serviceerror.NewNotFound("not found"),
	})
	step := NewTerminateExistingWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](fake)

	reqCtx := buildAgentTerminateStepContext("exec-456")
	err := step.Execute(reqCtx)
	require.NoError(t, err)

	require.Len(t, fake.calls, 1)
	assert.Equal(t, workflowID, fake.calls[0].WorkflowID)
}

func TestTerminateExistingWorkflow_TerminateFails_ReturnsError(t *testing.T) {
	workflowID := expectedAgentWorkflowID("exec-fail")
	fake := newFakeTemporalClient(map[string]error{
		workflowID: fmt.Errorf("temporal unavailable"),
	})
	step := NewTerminateExistingWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](fake)

	reqCtx := buildAgentTerminateStepContext("exec-fail")
	err := step.Execute(reqCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to terminate previous workflow during recovery")

	require.Len(t, fake.calls, 1)
	assert.Equal(t, workflowID, fake.calls[0].WorkflowID)
}

func TestTerminateExistingWorkflow_SkipsWhenAlreadyInTargetState(t *testing.T) {
	fake := newFakeTemporalClient(nil)
	step := NewTerminateExistingWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](fake)

	reqCtx := buildAgentTerminateStepContext("exec-skip")
	reqCtx.Set("alreadyInTargetState", true)

	err := step.Execute(reqCtx)
	require.NoError(t, err)
	assert.Empty(t, fake.calls, "should not make any Temporal calls when already in target state")
}

func TestTerminateExistingWorkflow_FailsWhenTemporalClientNil(t *testing.T) {
	step := NewTerminateExistingWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](nil)

	reqCtx := buildAgentTerminateStepContext("exec-nil")
	err := step.Execute(reqCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Temporal is not available")
}

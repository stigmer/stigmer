package harness

import (
	"context"
	"fmt"
	"testing"

	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TemporalInspector queries the Temporal dev server directly to inspect
// workflow state, bypassing the Stigmer gRPC API. This enables assertions
// about Temporal-level behavior that the Stigmer API cannot expose:
// split-brain detection, WorkflowTaskFailed loops, terminal event types,
// run IDs, and child workflow state.
type TemporalInspector struct {
	client client.Client
}

// NewTemporalInspector creates an inspector connected to the Temporal dev server.
func NewTemporalInspector(temporalClient client.Client) *TemporalInspector {
	return &TemporalInspector{client: temporalClient}
}

// OrchestratorWorkflowID returns the Temporal workflow ID for a workflow
// execution orchestrator, following the convention used by both Go and Java backends.
func OrchestratorWorkflowID(executionID string) string {
	return fmt.Sprintf("stigmer/workflow-execution/invoke/%s", executionID)
}

// ChildWorkflowID returns the Temporal workflow ID for the TS child workflow
// started by the orchestrator.
func ChildWorkflowID(executionID string) string {
	return fmt.Sprintf("workflow-exec-%s", executionID)
}

// AgentOrchestratorWorkflowID returns the Temporal workflow ID for an
// agent execution orchestrator.
func AgentOrchestratorWorkflowID(executionID string) string {
	return fmt.Sprintf("stigmer/agent-execution/invoke/%s", executionID)
}

// GetWorkflowStatus queries Temporal for the current status of a workflow.
func (ti *TemporalInspector) GetWorkflowStatus(ctx context.Context, workflowID string) (enumspb.WorkflowExecutionStatus, error) {
	desc, err := ti.client.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		return 0, fmt.Errorf("describe workflow %s: %w", workflowID, err)
	}
	return desc.WorkflowExecutionInfo.Status, nil
}

// GetWorkflowRunID returns the current run ID for a workflow.
func (ti *TemporalInspector) GetWorkflowRunID(ctx context.Context, workflowID string) (string, error) {
	desc, err := ti.client.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		return "", fmt.Errorf("describe workflow %s: %w", workflowID, err)
	}
	return desc.WorkflowExecutionInfo.Execution.RunId, nil
}

// IsWorkflowOpen returns true if the workflow is still in a non-terminal state.
func (ti *TemporalInspector) IsWorkflowOpen(ctx context.Context, workflowID string) (bool, error) {
	status, err := ti.GetWorkflowStatus(ctx, workflowID)
	if err != nil {
		return false, err
	}
	return status == enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING, nil
}

// CountWorkflowTaskFailedEvents scans the workflow's event history and counts
// WorkflowTaskFailed events. A count > 0 indicates the workflow experienced
// task retry loops. An escalating count (>1) strongly suggests the workflow
// was or is stuck in the infinite retry loop caused by the RECORD_MARKER /
// RuntimeException bugs.
func (ti *TemporalInspector) CountWorkflowTaskFailedEvents(ctx context.Context, workflowID string) (int, error) {
	iter := ti.client.GetWorkflowHistory(ctx, workflowID, "", false,
		enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)

	count := 0
	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return count, fmt.Errorf("read history for %s: %w", workflowID, err)
		}
		if event.GetEventType() == enumspb.EVENT_TYPE_WORKFLOW_TASK_FAILED {
			count++
		}
	}
	return count, nil
}

// GetHistoryEvents returns all events of a specific type from the workflow history.
func (ti *TemporalInspector) GetHistoryEvents(ctx context.Context, workflowID string, eventType enumspb.EventType) ([]*historypb.HistoryEvent, error) {
	iter := ti.client.GetWorkflowHistory(ctx, workflowID, "", false,
		enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)

	var events []*historypb.HistoryEvent
	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return events, fmt.Errorf("read history for %s: %w", workflowID, err)
		}
		if event.GetEventType() == eventType {
			events = append(events, event)
		}
	}
	return events, nil
}

// isTemporalTerminal returns true if the Temporal workflow status is a
// terminal state.
func isTemporalTerminal(status enumspb.WorkflowExecutionStatus) bool {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return true
	default:
		return false
	}
}

// --- Assertion helpers ---

// AssertTemporalTerminal verifies that the Temporal workflow reached a
// terminal state (COMPLETED, FAILED, CANCELED, TERMINATED, or TIMED_OUT).
func (ti *TemporalInspector) AssertTemporalTerminal(t *testing.T, ctx context.Context, workflowID string) {
	t.Helper()
	status, err := ti.GetWorkflowStatus(ctx, workflowID)
	require.NoError(t, err, "should be able to describe workflow %s", workflowID)
	assert.True(t, isTemporalTerminal(status),
		"Temporal workflow %s should be in terminal state, got %s", workflowID, status.String())
}

// AssertTemporalStatus verifies that the Temporal workflow is in the
// exact expected status.
func (ti *TemporalInspector) AssertTemporalStatus(t *testing.T, ctx context.Context, workflowID string, expected enumspb.WorkflowExecutionStatus) {
	t.Helper()
	status, err := ti.GetWorkflowStatus(ctx, workflowID)
	require.NoError(t, err, "should be able to describe workflow %s", workflowID)
	assert.Equal(t, expected, status,
		"Temporal workflow %s: expected status %s, got %s",
		workflowID, expected.String(), status.String())
}

// AssertNoWTFLoop verifies that the workflow's history does not contain
// more than maxAllowed WorkflowTaskFailed events. A single transient
// WTF event is acceptable (Temporal retries workflow tasks on transient
// errors); an escalating count indicates the workflow was stuck in an
// infinite retry loop.
func (ti *TemporalInspector) AssertNoWTFLoop(t *testing.T, ctx context.Context, workflowID string, maxAllowed int) {
	t.Helper()
	count, err := ti.CountWorkflowTaskFailedEvents(ctx, workflowID)
	require.NoError(t, err, "should be able to read history for %s", workflowID)
	assert.LessOrEqual(t, count, maxAllowed,
		"Temporal workflow %s had %d WorkflowTaskFailed events (max allowed: %d) — "+
			"indicates a task retry loop (stuck workflow)", workflowID, count, maxAllowed)
}

// AssertStateConsistency compares the Temporal workflow execution status with
// the Stigmer gRPC execution phase to detect split-brain state.
//
// Mapping: Temporal COMPLETED/FAILED → Stigmer COMPLETED or FAILED (both are valid
// because the orchestrator returns ApplicationError on business failure, which
// shows as FAILED in Temporal, but some paths show COMPLETED because the error was
// handled). The key assertion is that if Temporal shows RUNNING, Stigmer should
// NOT show a terminal phase (and vice versa).
func (ti *TemporalInspector) AssertStateConsistency(
	t *testing.T,
	ctx context.Context,
	workflowID string,
	stigmerExec *workflowexecutionv1.WorkflowExecution,
) {
	t.Helper()
	temporalStatus, err := ti.GetWorkflowStatus(ctx, workflowID)
	require.NoError(t, err, "should be able to describe workflow %s", workflowID)

	stigmerPhase := stigmerExec.GetStatus().GetPhase()
	stigmerTerminal := isTerminalPhase(stigmerPhase)
	temporalTerminal := isTemporalTerminal(temporalStatus)

	if temporalTerminal && !stigmerTerminal {
		t.Errorf("SPLIT-BRAIN: Temporal workflow %s is %s (terminal) but Stigmer phase is %s (non-terminal)",
			workflowID, temporalStatus.String(), stigmerPhase.String())
	}
	if !temporalTerminal && stigmerTerminal {
		t.Errorf("SPLIT-BRAIN: Temporal workflow %s is %s (non-terminal) but Stigmer phase is %s (terminal)",
			workflowID, temporalStatus.String(), stigmerPhase.String())
	}
}

// --- ExecutionContext assertion helpers ---

// AssertExecutionContextDeleted verifies that no ExecutionContext exists for
// the given execution ID. This confirms cleanup activities ran on the
// success/failure/cancel path.
func AssertExecutionContextDeleted(
	t *testing.T,
	ctx context.Context,
	ecClient executionctxv1.ExecutionContextQueryControllerClient,
	executionID string,
) {
	t.Helper()
	_, err := ecClient.GetByExecutionId(ctx, &executionctxv1.ExecutionContextExecutionIdInput{
		ExecutionId: executionID,
	})
	assert.Error(t, err,
		"ExecutionContext for %s should be deleted (cleanup should have run), but it still exists",
		executionID)
}

// AssertExecutionContextExists verifies that an ExecutionContext exists for
// the given execution ID. Used after recovery to confirm EC recreation.
func AssertExecutionContextExists(
	t *testing.T,
	ctx context.Context,
	ecClient executionctxv1.ExecutionContextQueryControllerClient,
	executionID string,
) {
	t.Helper()
	ec, err := ecClient.GetByExecutionId(ctx, &executionctxv1.ExecutionContextExecutionIdInput{
		ExecutionId: executionID,
	})
	require.NoError(t, err,
		"ExecutionContext for %s should exist (EC recreation should have run)", executionID)
	assert.NotNil(t, ec, "ExecutionContext should not be nil")
}

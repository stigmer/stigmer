//go:build integration

package integration

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// --- Task-Level Recovery Resume Tests ---
//
// These tests verify the task-level resume semantics introduced by T01-T06:
// - Completed tasks are skipped (task_skipped events, WORKFLOW_TASK_SKIPPED status)
// - Event sequence numbers continue from the pre-recovery high-water mark
// - Non-trivial task types (agent_call) are correctly handled through the skip path
//
// Temporal-level durability (run IDs, EC recreation, idempotency, phase guards)
// is covered separately in workflow_execution_recover_test.go.

// multiTaskFailingWorkflow returns a three-task workflow that always fails:
//
//	initVars (set_vars, exports) → deriveVars (set_vars, reads $context.initVars, exports) → failTask (raise_error)
//
// The two set_vars tasks complete and export to $context, exercising the context
// chain. The raise_error task deterministically fails. On recovery, the runner
// skips the two completed tasks and re-executes the raise_error.
func multiTaskFailingWorkflow(name string) (*workflowv1.Workflow, error) {
	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"source": "alpha",
			"value":  float64(42),
		},
	})
	if err != nil {
		return nil, err
	}

	deriveConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"derived": "${ $context.initVars.source }-beta",
		},
	})
	if err != nil {
		return nil, err
	}

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "RecoveryTestError",
		"message": "deliberate failure for recovery test",
	})
	if err != nil {
		return nil, err
	}

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: multi-task workflow for recovery task-resume tests",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "deriveVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: deriveConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "failTask",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}, nil
}

// TestRecover_SkipsCompletedTasks verifies that recovery skips previously
// completed tasks (emitting task_skipped events with WORKFLOW_TASK_SKIPPED
// status) and re-executes only the failed task.
//
// Workflow: initVars (set_vars) → deriveVars (set_vars) → failTask (raise_error)
//
// First run:  initVars=COMPLETED, deriveVars=COMPLETED, failTask=FAILED
// Recovery:   initVars=SKIPPED,   deriveVars=SKIPPED,   failTask=FAILED (re-executed)
//
// Verifies: T02 (task-level resume), T03 (recovery flag propagation),
// T06 (child workflow cleanup — secondary, via TemporalInspector).
func TestRecover_SkipsCompletedTasks(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "recover-skip", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := multiTaskFailingWorkflow("recover-skip-completed")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "recovery task skip test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// --- First run: wait for failure, verify pre-recovery task statuses ---

	preRecovery, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution %s should reach FAILED", executionID)

	harness.AssertAllTaskStatuses(t, preRecovery, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"initVars":   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"deriveVars": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"failTask":   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED,
	})

	t.Logf("pre-recovery: execution=%s, all tasks in expected states", executionID)

	// --- Recover ---

	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "task skip verification",
	})
	require.NoError(t, err, "recover should succeed for FAILED execution %s", executionID)

	postRecovery, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "execution %s should reach terminal after recovery", executionID)

	// --- Assert post-recovery task statuses ---

	harness.AssertAllTaskStatuses(t, postRecovery, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"initVars":   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED,
		"deriveVars": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED,
		"failTask":   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED,
	})

	t.Logf("post-recovery: execution=%s, completed tasks correctly skipped", executionID)

	// --- Assert event log contains task_skipped events ---

	logResp, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed for execution %s", executionID)
	require.NotEmpty(t, logResp.GetEvents(), "event log should not be empty")

	var skippedEvents []*workflowexecutionv1.WorkflowExecutionEvent
	var failTaskStarted, failTaskFailed bool
	for _, evt := range logResp.GetEvents() {
		if evt.GetEventType() == workflowexecutionv1.WorkflowEventType_task_skipped {
			skippedEvents = append(skippedEvents, evt)
		}
		if evt.GetEventType() == workflowexecutionv1.WorkflowEventType_task_started && evt.GetTaskName() == "failTask" {
			failTaskStarted = true
		}
		if evt.GetEventType() == workflowexecutionv1.WorkflowEventType_task_failed && evt.GetTaskName() == "failTask" {
			failTaskFailed = true
		}
	}

	assert.Len(t, skippedEvents, 2,
		"expected exactly 2 task_skipped events (initVars + deriveVars), got %d", len(skippedEvents))

	skippedNames := make(map[string]bool)
	for _, evt := range skippedEvents {
		skippedNames[evt.GetTaskName()] = true
		reason := evt.GetTaskSkipped().GetReason()
		assert.True(t, strings.Contains(reason, "recovery"),
			"task_skipped event for %q should have recovery reason, got %q",
			evt.GetTaskName(), reason)
	}
	assert.True(t, skippedNames["initVars"], "initVars should have a task_skipped event")
	assert.True(t, skippedNames["deriveVars"], "deriveVars should have a task_skipped event")

	assert.True(t, failTaskStarted,
		"failTask should have a task_started event (re-execution, not skip)")
	assert.True(t, failTaskFailed,
		"failTask should have a task_failed event (re-execution)")

	// --- Temporal assertions (secondary: child cleanup from T06) ---

	orchID := harness.OrchestratorWorkflowID(executionID)
	childID := harness.ChildWorkflowID(executionID)

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertTemporalTerminal(t, ctx, childID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 1)

	t.Logf("recovery task skip verified: execution=%s, 2 skipped, failTask re-executed, Temporal clean",
		executionID)
}

// TestRecover_EventSequenceContinuation verifies that post-recovery events
// have sequence numbers strictly greater than the pre-recovery high-water mark,
// with no duplicates or out-of-order events across the full log.
//
// Verifies: T01 (event sequence continuation from high-water mark).
func TestRecover_EventSequenceContinuation(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "recover-seq", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := multiTaskFailingWorkflow("recover-seq-continuation")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "event sequence continuation test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// --- First run: wait for failure, capture high-water mark ---

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution %s should reach FAILED", executionID)

	preLog, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed before recovery")
	require.NotEmpty(t, preLog.GetEvents(), "pre-recovery event log should not be empty")

	highWaterMark := preLog.GetLatestSequence()
	require.Greater(t, highWaterMark, uint64(0),
		"high-water mark should be > 0 after first run")

	// Verify pre-recovery events are monotonically increasing
	var prevSeq uint64
	for i, evt := range preLog.GetEvents() {
		seq := evt.GetSequenceNumber()
		assert.Greater(t, seq, prevSeq,
			"pre-recovery event[%d]: seq %d must be > previous %d", i, seq, prevSeq)
		prevSeq = seq
	}

	preCount := len(preLog.GetEvents())
	t.Logf("pre-recovery: execution=%s, %d events, high-water mark=%d",
		executionID, preCount, highWaterMark)

	// --- Recover ---

	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "sequence continuation verification",
	})
	require.NoError(t, err)

	_, err = waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "execution %s should reach terminal after recovery", executionID)

	// --- Fetch full event log (pre + post recovery, additive) ---

	fullLog, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed after recovery")

	allEvents := fullLog.GetEvents()
	require.Greater(t, len(allEvents), preCount,
		"full log should have more events than pre-recovery (%d)", preCount)

	// --- Partition into pre/post recovery and assert ---

	var postRecoveryCount int
	seenSeqs := make(map[uint64]bool)
	prevSeq = 0

	for i, evt := range allEvents {
		seq := evt.GetSequenceNumber()

		assert.Greater(t, seq, prevSeq,
			"full log event[%d]: seq %d must be > previous %d (monotonic increase)",
			i, seq, prevSeq)
		prevSeq = seq

		assert.False(t, seenSeqs[seq],
			"duplicate sequence number %d at event[%d]", seq, i)
		seenSeqs[seq] = true

		if seq > highWaterMark {
			postRecoveryCount++
		}
	}

	assert.Greater(t, postRecoveryCount, 0,
		"should have post-recovery events with seq > high-water mark %d", highWaterMark)

	t.Logf("sequence continuation verified: execution=%s, pre=%d events (hwm=%d), post=%d events, total=%d, monotonic=true",
		executionID, preCount, highWaterMark, postRecoveryCount, len(allEvents))
}

// TestRecover_AgentCallTaskSkip verifies that agent_call tasks — which
// produce structurally richer outputs than set_vars (token usage, tool calls,
// metadata) — are correctly handled through the recovery skip path.
//
// Workflow: agentCallTask (agent_call, succeeds) → failTask (raise_error, fails)
//
// First run:  agentCallTask=COMPLETED, failTask=FAILED
// Recovery:   agentCallTask=SKIPPED,   failTask=FAILED (re-executed)
//
// Requires CURSOR_API_KEY for the agent_call to succeed on the first run.
func TestRecover_AgentCallTaskSkip(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("CURSOR_API_KEY") == "" {
		t.Skip("CURSOR_API_KEY not set — skipping agent_call recovery skip test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "recover-agent-skip", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients,
		"recover-agent-skip-agent",
		"You are a minimal test agent. Respond with exactly: recovery-test-ok")

	agentCallConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: recovery-test-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "RecoveryTestError",
		"message": "deliberate failure after agent_call for recovery test",
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "recover-agent-call-skip",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call task skip on recovery",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "recover-agent-call-skip",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "agentCallTask",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: agentCallConfig,
				},
				{
					Name:       "failTask",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "agent_call recovery skip test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// --- First run: agent_call succeeds, raise_error fails ---

	preRecovery, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 3*time.Minute)
	require.NoError(t, err, "execution %s should reach FAILED (agent_call succeeds, raise_error fails)", executionID)

	harness.AssertTaskStatus(t, preRecovery, "agentCallTask",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, preRecovery, "failTask",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	t.Logf("pre-recovery: execution=%s, agentCallTask=COMPLETED, failTask=FAILED", executionID)

	// --- Recover ---

	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "agent_call task skip verification",
	})
	require.NoError(t, err, "recover should succeed for execution %s", executionID)

	postRecovery, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "execution %s should reach terminal after recovery", executionID)

	// --- Assert agent_call task was skipped on recovery ---

	harness.AssertTaskStatus(t, postRecovery, "agentCallTask",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED)
	harness.AssertTaskStatus(t, postRecovery, "failTask",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	// --- Assert event log confirms the skip ---

	logResp, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed for execution %s", executionID)

	var agentSkipped bool
	for _, evt := range logResp.GetEvents() {
		if evt.GetEventType() == workflowexecutionv1.WorkflowEventType_task_skipped &&
			evt.GetTaskName() == "agentCallTask" {
			agentSkipped = true
			reason := evt.GetTaskSkipped().GetReason()
			assert.True(t, strings.Contains(reason, "recovery"),
				"agent_call task_skipped reason should mention recovery, got %q", reason)
		}
	}

	assert.True(t, agentSkipped,
		"agentCallTask should have a task_skipped event in the post-recovery event log")

	t.Logf("agent_call recovery skip verified: execution=%s, agentCallTask=SKIPPED, failTask re-executed",
		executionID)
}

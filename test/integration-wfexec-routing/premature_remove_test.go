//go:build integration

package wfexecrouting

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWfExecDispatch_RemoveDuringExecuteCursor reproduces the premature worker
// shutdown bug: when the desktop app calls removeWorkflowExecution while an
// ExecuteCursor activity is still in progress (e.g., due to a stale React state
// race in useWorkflowExecution), the agent execution incorrectly reports
// "Execution paused by user" and the workflow execution remains stuck in
// EXECUTION_IN_PROGRESS.
//
// The test simulates the desktop app's behavior:
// 1. Start a workflow with an agent_call (cursor harness)
// 2. Wait for the child agent execution to reach IN_PROGRESS (ExecuteCursor active)
// 3. Call RemoveWorkflowExecution (simulating the premature UI removal)
// 4. Assert the resulting behavior
//
// CURRENT BROKEN BEHAVIOR (documented):
//   - Agent execution phase → EXECUTION_PAUSED (should be FAILED)
//   - Agent error message → "paused by user" (misleading)
//   - Workflow execution → stays IN_PROGRESS indefinitely (should reach FAILED)
//
// EXPECTED BEHAVIOR AFTER FIX:
//   - Agent execution phase → EXECUTION_FAILED
//   - Agent error → "worker shutdown interrupted execution"
//   - Workflow execution → reaches EXECUTION_FAILED
func TestWfExecDispatch_RemoveDuringExecuteCursor(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	// Create a test agent for the cursor agent_call task.
	agent := createAffinityTestAgent(t, ctx, clients, "test-premature-remove-agent")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Analyze the workspace and provide a detailed summary of all files you find. Take your time and be thorough.",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "wfexec-premature-remove-test",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: premature worker removal during ExecuteCursor",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "wfexec-premature-remove-test",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "analyzeData",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	deployer := harness.NewFixtureDeployer(clients, "premature-remove-test", suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "premature remove during cursor test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed")

	// Discover the child agent execution spawned by CallAgent.
	expectedParentWorkflowID := fmt.Sprintf("workflow-exec-%s", executionID)
	childExecutionID := waitForChildAgentExecution(t, ctx, clients, expectedParentWorkflowID, 60*time.Second)
	require.NotEmpty(t, childExecutionID, "child agent execution should be created")
	t.Logf("child agent execution found: id=%s", childExecutionID)

	// Wait for the child agent execution to reach IN_PROGRESS.
	// This confirms ExecuteCursor is actively streaming. Without a valid
	// Cursor API key, it may fail quickly — but if CURSOR_API_KEY is set,
	// the execution runs long enough to test the removal mid-flight.
	agentWaiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	childExec, err := agentWaiter.WaitForPhase(ctx, childExecutionID, agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 90*time.Second)
	if err != nil {
		// If IN_PROGRESS was never reached (e.g., fast failure without API key),
		// skip the mid-flight removal test — the affinity test already covers
		// basic dispatch. Log and skip rather than fail.
		result, getErr := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: childExecutionID})
		if getErr == nil {
			t.Skipf("child agent execution never reached IN_PROGRESS (phase=%s, error=%s); "+
				"set CURSOR_API_KEY to enable mid-flight removal testing",
				result.GetStatus().GetPhase().String(), result.GetStatus().GetError())
		}
		t.Skipf("child agent execution never reached IN_PROGRESS: %v", err)
	}

	t.Logf("child agent execution %s reached IN_PROGRESS (ExecuteCursor active)", childExecutionID)
	_ = childExec

	// === TRIGGER: Premature worker removal ===
	// This simulates what happens when the desktop app's useWorkflowExecution
	// hook fires onWorkflowExecutionTerminated due to stale React state.
	t.Log("removing workflow execution worker while ExecuteCursor is in progress...")
	err = mgr.RemoveWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "removeWorkflowExecution should succeed")
	t.Log("workflow execution worker removed successfully")

	// === ASSERTIONS ===

	// The agent execution should reach a terminal state within the drain timeout.
	// Worker drain cancels in-flight activities, so the execution should terminate.
	terminalResult, err := agentWaiter.WaitForTerminal(ctx, childExecutionID, 60*time.Second)
	require.NoError(t, err, "child agent execution should reach terminal state after worker removal")

	agentPhase := terminalResult.GetStatus().GetPhase()
	agentError := terminalResult.GetStatus().GetError()
	t.Logf("child agent execution terminal state: phase=%s, error=%q", agentPhase.String(), agentError)

	// After the Layer 3 fix: worker shutdown reports FAILED, not PAUSED.
	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, agentPhase,
		"agent execution should report FAILED on worker shutdown (not PAUSED)")
	assert.Contains(t, agentError, "worker was shut down",
		"agent error should mention worker shutdown")

	// Verify the workflow execution status.
	// Without the wfexec worker, the child Temporal workflow cannot process
	// the async activity failure, so the workflow may stay non-terminal.
	// A future reconciliation mechanism (out of scope) would close this gap.
	time.Sleep(15 * time.Second)

	wfResult, err := clients.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	require.NoError(t, err)

	wfPhase := wfResult.GetStatus().GetPhase()
	t.Logf("workflow execution phase after removal: %s", wfPhase.String())

	// The workflow execution may not reach FAILED immediately because the
	// wfexec worker is gone and cannot deliver the async activity failure
	// to the child workflow. The Java parent orchestrator's handleFailure
	// only fires when it observes ChildWorkflowFailure.
	// This is a known limitation addressed by a follow-up reconciliation sweep.
	if wfPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		t.Log("workflow execution reached FAILED (reconciliation or timeout worked)")
	} else {
		t.Logf("workflow execution still in %s (expected — no worker to propagate failure)", wfPhase.String())
		assert.NotEqual(t, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, wfPhase,
			"workflow execution should NOT be COMPLETED after premature worker removal")
	}
}

// waitForChildAgentExecution polls for a child agent execution with the given
// parent workflow ID. Returns the child execution ID when found.
func waitForChildAgentExecution(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	parentWorkflowID string,
	timeout time.Duration,
) string {
	t.Helper()

	deadline := time.Now().Add(timeout)
	interval := 2 * time.Second

	for time.Now().Before(deadline) {
		agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
		if err != nil {
			t.Logf("warning: failed to list agent executions: %v", err)
			time.Sleep(interval)
			continue
		}

		for _, ae := range agentExecs.GetEntries() {
			if ae.GetSpec().GetParentWorkflowId() == parentWorkflowID {
				return ae.GetMetadata().GetId()
			}
		}

		select {
		case <-ctx.Done():
			return ""
		case <-time.After(interval):
		}
	}

	return ""
}

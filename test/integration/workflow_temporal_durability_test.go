//go:build integration

package integration

import (
	"context"
	"fmt"
	"sync"
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

// newTemporalInspector creates a TemporalInspector connected to the test
// harness's Temporal dev server. Must be called after testHarness is initialized.
func newTemporalInspector(t *testing.T) *harness.TemporalInspector {
	t.Helper()
	require.NotNil(t, testHarness.Temporal, "Temporal dev server must be available")
	tc, err := testHarness.Temporal.Client()
	require.NoError(t, err, "should connect to Temporal")
	t.Cleanup(func() { tc.Close() })
	return harness.NewTemporalInspector(tc)
}

// --- Phase 2: Failure Terminal State Tests ---

// TestDurability_RaiseError_ReachesTerminal verifies that a workflow with a
// raise_error task reaches terminal state at BOTH the Stigmer DB layer and
// the Temporal layer, with no WorkflowTaskFailed retry loops.
func TestDurability_RaiseError_ReachesTerminal(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "dur-raise", suiteLogger)
	defer deployer.Cleanup(ctx)

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "DurabilityTestError",
		"message": "deliberately raised for durability test",
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "durability-raise-error",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Durability test: raise_error reaches terminal cleanly",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "durability-raise-error",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failTask",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "durability raise_error test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "execution %s should reach terminal phase", executionID)

	// Stigmer DB assertions
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	assert.NotEmpty(t, result.GetStatus().GetError(),
		"failed execution should have a populated error message")

	// Temporal assertions
	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 1)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("durability: raise_error reached terminal — Stigmer=%s, no WTF loop",
		result.GetStatus().GetPhase().String())
}

// TestDurability_RaiseError_CleanupCommits verifies that the ExecutionContext
// is cleaned up after a workflow failure. This catches the bug where finally
// block activities were silently lost on failure paths.
func TestDurability_RaiseError_CleanupCommits(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "dur-cleanup", suiteLogger)
	defer deployer.Cleanup(ctx)

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "CleanupTestError",
		"message": "raised to verify cleanup runs on failure",
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "durability-cleanup-on-fail",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Durability test: EC cleanup on failure path",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "durability-cleanup-on-fail",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failForCleanup",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "cleanup verification test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution should reach FAILED")

	// Give cleanup activities a moment to complete (they run in disconnected context)
	time.Sleep(3 * time.Second)

	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("durability: EC cleanup confirmed after failure for execution %s", executionID)
}

// TestDurability_ChildWorkflowFailure_PropagatesCleanly verifies that when
// the TS child workflow fails (e.g., a task in the middle of a multi-step
// workflow throws), the parent Go/Java orchestrator also reaches terminal
// state cleanly — no WTF loop, status consistent.
func TestDurability_ChildWorkflowFailure_PropagatesCleanly(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "dur-child-fail", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"step": "init"},
	})
	require.NoError(t, err)
	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "MidWorkflowError",
		"message": "failure in middle of multi-step workflow",
	})
	require.NoError(t, err)
	finalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"step": "should-not-reach"},
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "durability-child-failure",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Durability test: multi-step with mid-workflow failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "durability-child-failure",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "initStep", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: initConfig},
				{Name: "failStep", Kind: workflowv1.WorkflowTaskKind_raise_error, TaskConfig: raiseConfig},
				{Name: "unreachable", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: finalConfig},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "child failure propagation test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "execution should reach terminal")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)

	// Both parent orchestrator and child workflow should be terminal
	orchID := harness.OrchestratorWorkflowID(executionID)
	childID := harness.ChildWorkflowID(executionID)

	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertTemporalTerminal(t, ctx, childID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 1)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	// Verify the first task ran but the last task did not
	harness.AssertTaskStatus(t, result, "initStep",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "failStep",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	t.Logf("durability: child failure propagated cleanly to parent for execution %s", executionID)
}

// TestDurability_TryCatch_FailureCaught verifies that a raise_error inside
// a try block is caught by the catch block, the workflow completes, and both
// Temporal and Stigmer agree on the terminal state.
func TestDurability_TryCatch_FailureCaught(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "dur-trycatch", suiteLogger)
	defer deployer.Cleanup(ctx)

	tryCatchConfig, err := structpb.NewStruct(map[string]any{
		"try": []any{
			map[string]any{
				"name": "riskyOp",
				"kind": "raise_error",
				"task_config": map[string]any{
					"error":   "CatchableError",
					"message": "this should be caught",
				},
			},
		},
		"catch": map[string]any{
			"as": "error",
			"do": []any{
				map[string]any{
					"name": "handleErr",
					"kind": "set_vars",
					"task_config": map[string]any{
						"variables": map[string]any{"caught": "true"},
					},
				},
			},
		},
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "durability-try-catch",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Durability test: try/catch handles failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "durability-try-catch",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "safeOp", Kind: workflowv1.WorkflowTaskKind_try_catch, TaskConfig: tryCatchConfig},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "try-catch durability test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err, "workflow should complete (error caught)")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 0)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("durability: try/catch completed — error caught, Temporal clean")
}

// TestDurability_MultipleSequentialFailures verifies that a multi-step workflow
// where an early task fails does not execute subsequent tasks, and the overall
// workflow reaches FAILED cleanly.
func TestDurability_MultipleSequentialFailures(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "dur-seq-fail", suiteLogger)
	defer deployer.Cleanup(ctx)

	beforeConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"before": "true"},
	})
	require.NoError(t, err)
	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "SequentialError",
		"message": "fail in sequence",
	})
	require.NoError(t, err)
	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"after": "should-not-run"},
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "durability-sequential-fail",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Durability test: sequential tasks with failure in middle",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "durability-sequential-fail",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "beforeFail", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: beforeConfig},
				{Name: "failHere", Kind: workflowv1.WorkflowTaskKind_raise_error, TaskConfig: raiseConfig},
				{Name: "afterFail", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: afterConfig},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "sequential failure test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	harness.AssertTaskStatus(t, result, "beforeFail",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "failHere",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 1)

	t.Logf("durability: sequential failure — stopped at failHere, Temporal clean")
}

// --- Phase 3: State Consistency and Concurrency ---

// TestConsistency_TemporalMatchesDB_OnSuccess verifies that after a
// successful workflow, both Temporal and Stigmer DB agree on the outcome.
func TestConsistency_TemporalMatchesDB_OnSuccess(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "consist-ok", suiteLogger)
	defer deployer.Cleanup(ctx)

	config, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"result": "success"},
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "consistency-success",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Consistency test: success path",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "consistency-success",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "setResult", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: config},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "consistency success test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertNoWTFLoop(t, ctx, orchID, 0)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	// EC should be cleaned up on success too
	time.Sleep(2 * time.Second)
	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("consistency: success — Temporal and Stigmer agree, EC cleaned up")
}

// TestConsistency_TemporalMatchesDB_OnFailure verifies state consistency
// after a workflow failure.
func TestConsistency_TemporalMatchesDB_OnFailure(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "consist-fail", suiteLogger)
	defer deployer.Cleanup(ctx)

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "ConsistencyError",
		"message": "raised for consistency test",
	})
	require.NoError(t, err)

	wf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "consistency-failure",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Consistency test: failure path",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "consistency-failure",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "failHere", Kind: workflowv1.WorkflowTaskKind_raise_error, TaskConfig: raiseConfig},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "consistency failure test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("consistency: failure — Temporal=%s, Stigmer=%s",
		func() string {
			s, _ := inspector.GetWorkflowStatus(ctx, orchID)
			return s.String()
		}(),
		result.GetStatus().GetPhase().String())
}

// TestConsistency_ConcurrentExecutions_NoInterference triggers multiple
// workflow executions concurrently and verifies that all reach terminal
// state independently with no stuck workflows or split-brain state.
func TestConsistency_ConcurrentExecutions_NoInterference(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)

	type execResult struct {
		executionID string
		phase       workflowexecutionv1.ExecutionPhase
		err         error
	}

	const concurrency = 5
	results := make(chan execResult, concurrency)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			deployer := harness.NewFixtureDeployer(clients, fmt.Sprintf("concurrent-%d", idx), suiteLogger)
			defer deployer.Cleanup(ctx)

			var taskKind workflowv1.WorkflowTaskKind
			var taskConfig *structpb.Struct
			var taskErr error

			if idx%2 == 0 {
				taskKind = workflowv1.WorkflowTaskKind_set_vars
				taskConfig, taskErr = structpb.NewStruct(map[string]any{
					"variables": map[string]any{"idx": float64(idx)},
				})
			} else {
				taskKind = workflowv1.WorkflowTaskKind_raise_error
				taskConfig, taskErr = structpb.NewStruct(map[string]any{
					"error":   "ConcurrentError",
					"message": fmt.Sprintf("fail from goroutine %d", idx),
				})
			}
			if taskErr != nil {
				results <- execResult{err: taskErr}
				return
			}

			wf := &workflowv1.Workflow{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Workflow",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: fmt.Sprintf("concurrent-durability-%d", idx),
					Org:  "test-org",
				},
				Spec: &workflowv1.WorkflowSpec{
					Description: fmt.Sprintf("Concurrent durability test %d", idx),
					Document: &workflowv1.WorkflowDocument{
						Dsl:       "1.0.0",
						Namespace: "test-org",
						Name:      fmt.Sprintf("concurrent-durability-%d", idx),
						Version:   "1.0.0",
					},
					Tasks: []*workflowv1.WorkflowTask{
						{Name: "task", Kind: taskKind, TaskConfig: taskConfig},
					},
				},
			}

			_, execution, deployErr := deployer.DeployAndExecute(ctx, wf, "concurrent test")
			if deployErr != nil {
				results <- execResult{err: deployErr}
				return
			}

			exID := execution.GetMetadata().GetId()
			waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
			result, waitErr := waiter.WaitForTerminal(ctx, exID, 90*time.Second)
			if waitErr != nil {
				results <- execResult{executionID: exID, err: waitErr}
				return
			}

			results <- execResult{
				executionID: exID,
				phase:       result.GetStatus().GetPhase(),
			}
		}(i)
	}

	wg.Wait()
	close(results)

	var allResults []execResult
	for r := range results {
		allResults = append(allResults, r)
	}

	require.Len(t, allResults, concurrency,
		"should have results from all %d concurrent executions", concurrency)

	for _, r := range allResults {
		require.NoError(t, r.err,
			"concurrent execution %s should not error", r.executionID)

		orchID := harness.OrchestratorWorkflowID(r.executionID)
		inspector.AssertTemporalTerminal(t, ctx, orchID)
		inspector.AssertNoWTFLoop(t, ctx, orchID, 1)

		t.Logf("concurrent execution %s reached %s", r.executionID, r.phase.String())
	}
}

// TestConsistency_TemporalMatchesDB_OnCancel verifies state consistency
// after cancelling a running workflow.
func TestConsistency_TemporalMatchesDB_OnCancel(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "consist-cancel", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("consistency-cancel")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "consistency cancel test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err, "execution should reach IN_PROGRESS")

	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id:     executionID,
		Reason: "consistency cancel test",
	})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	// Verify EC cleanup after cancel
	time.Sleep(3 * time.Second)
	harness.AssertExecutionContextDeleted(t, ctx, clients.ExecutionContextQuery, executionID)

	t.Logf("consistency: cancel — Temporal and Stigmer agree, EC cleaned up")
}

// TestConsistency_TemporalMatchesDB_OnTerminate verifies state consistency
// after terminating a running workflow.
func TestConsistency_TemporalMatchesDB_OnTerminate(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "consist-term", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("consistency-terminate")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "consistency terminate test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Terminate(ctx, &workflowexecutionv1.TerminateWorkflowExecutionInput{
		Id:     executionID,
		Reason: "consistency terminate test",
	})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, 90*time.Second)
	require.NoError(t, err)

	orchID := harness.OrchestratorWorkflowID(executionID)
	inspector.AssertTemporalTerminal(t, ctx, orchID)
	inspector.AssertStateConsistency(t, ctx, orchID, result)

	t.Logf("consistency: terminate — Temporal and Stigmer agree")
}

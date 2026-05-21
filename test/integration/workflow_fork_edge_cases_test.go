//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowFork_BranchErrorNonCompete verifies that when one branch in a
// non-competing fork raises an error, the entire fork task fails.
//
// Workflow:
//
//	forkWithError (fork, compete=false)
//	  ├─ goodBranch: set_vars {result: "ok"}
//	  └─ badBranch: raise_error "BranchFailed"
func TestWorkflowFork_BranchErrorNonCompete(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "fork-err", suiteLogger)
	defer deployer.Cleanup(ctx)

	forkConfig, err := structpb.NewStruct(map[string]any{
		"branches": []any{
			map[string]any{
				"name": "goodBranch",
				"do": []any{
					map[string]any{
						"name": "setResult",
						"kind": "set_vars",
						"task_config": map[string]any{
							"variables": map[string]any{
								"result": "ok",
							},
						},
					},
				},
			},
			map[string]any{
				"name": "badBranch",
				"do": []any{
					map[string]any{
						"name": "raiseErr",
						"kind": "raise_error",
						"task_config": map[string]any{
							"error":   "BranchFailed",
							"message": "intentional branch failure for testing",
						},
					},
				},
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-fork-branch-error",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: fork with branch error (non-compete)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-fork-branch-error",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "forkWithError",
					Kind:       workflowv1.WorkflowTaskKind_fork,
					TaskConfig: forkConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "fork branch error test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	t.Logf("fork branch error: one branch failed, entire fork correctly failed")
}

// TestWorkflowFork_CompeteCancellationTiming documents the timing behavior
// of fork compete mode.
//
// Current runtime behavior: fork compete waits for all branches to finish
// rather than cancelling losing branches immediately. The fast branch
// result is selected, but the slow branch runs to completion.
//
// Workflow:
//
//	race (fork, compete=true)
//	  ├─ fastBranch: set_vars (immediate)
//	  └─ slowBranch: wait 5s → set_vars
func TestWorkflowFork_CompeteCancellationTiming(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "fork-race", suiteLogger)
	defer deployer.Cleanup(ctx)

	forkConfig, err := structpb.NewStruct(map[string]any{
		"compete": true,
		"branches": []any{
			map[string]any{
				"name": "fastBranch",
				"do": []any{
					map[string]any{
						"name": "setFast",
						"kind": "set_vars",
						"task_config": map[string]any{
							"variables": map[string]any{
								"winner": "fast",
							},
						},
					},
				},
			},
			map[string]any{
				"name": "slowBranch",
				"do": []any{
					map[string]any{
						"name": "waitLong",
						"kind": "wait",
						"task_config": map[string]any{
							"duration": map[string]any{
								"seconds": float64(5),
							},
						},
					},
					map[string]any{
						"name": "setSlow",
						"kind": "set_vars",
						"task_config": map[string]any{
							"variables": map[string]any{
								"winner": "slow",
							},
						},
					},
				},
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-fork-race-timing",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: fork compete cancellation timing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-fork-race-timing",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "race",
					Kind:       workflowv1.WorkflowTaskKind_fork,
					TaskConfig: forkConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	start := time.Now()
	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "fork compete timing test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	elapsed := time.Since(start)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("fork compete timing: completed in %v (runtime currently waits for all branches)", elapsed)
}

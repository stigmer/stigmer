//go:build integration

package integration

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// TestReplay_CaptureOrchestratorHistories exports Temporal histories from
// real workflow executions that exercise different paths (success, failure,
// cancel) in the Go orchestrator. These histories are written to the test
// output directory and can be replayed by the backend unit tests
// (invoke_workflow_impl_test.go) to detect non-determinism.
//
// This test extends the existing replay_capture_test.go pattern to also
// export the OUTER orchestrator history (not just the inner TS child),
// which is what must be deterministic across code changes.
func TestReplay_CaptureOrchestratorHistories(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	outputDir := filepath.Join(testHarness.OutputDir(), "replay-orchestrator-histories")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatalf("create replay output dir: %v", err)
	}

	temporalClient, err := harness.NewTemporalClient(testHarness.Temporal.Address())
	require.NoError(t, err)
	defer temporalClient.Close()

	exporter := harness.NewHistoryExporter(temporalClient, outputDir)

	type captureCase struct {
		name          string
		expectedPhase workflowexecutionv1.ExecutionPhase
		setup         func(t *testing.T) string
	}

	cases := []captureCase{
		{
			name:          "orchestrator-success",
			expectedPhase: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			setup: func(t *testing.T) string {
				t.Helper()
				ctx := context.Background()
				clients := harness.NewClients(grpcConn)
				deployer := harness.NewFixtureDeployer(clients, "orch-replay-ok", suiteLogger)
				t.Cleanup(func() { deployer.Cleanup(ctx) })

				wf, err := fastWorkflow("orch-replay-success")
				require.NoError(t, err)

				_, execution, err := deployer.DeployAndExecute(ctx, wf, "orchestrator replay: success")
				require.NoError(t, err)
				exID := execution.GetMetadata().GetId()

				waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
				_, err = waiter.WaitForPhase(ctx, exID,
					workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
				require.NoError(t, err)
				return exID
			},
		},
		{
			name:          "orchestrator-failure",
			expectedPhase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			setup: func(t *testing.T) string {
				t.Helper()
				ctx := context.Background()
				clients := harness.NewClients(grpcConn)
				deployer := harness.NewFixtureDeployer(clients, "orch-replay-fail", suiteLogger)
				t.Cleanup(func() { deployer.Cleanup(ctx) })

				wf, err := failingWorkflow("orch-replay-failure")
				require.NoError(t, err)

				_, execution, err := deployer.DeployAndExecute(ctx, wf, "orchestrator replay: failure")
				require.NoError(t, err)
				exID := execution.GetMetadata().GetId()

				waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
				_, err = waiter.WaitForTerminal(ctx, exID, 90*time.Second)
				require.NoError(t, err)
				return exID
			},
		},
		{
			name:          "orchestrator-cancel",
			expectedPhase: workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			setup: func(t *testing.T) string {
				t.Helper()
				ctx := context.Background()
				clients := harness.NewClients(grpcConn)
				deployer := harness.NewFixtureDeployer(clients, "orch-replay-cancel", suiteLogger)
				t.Cleanup(func() { deployer.Cleanup(ctx) })

				wf, err := blockingWorkflow("orch-replay-cancel")
				require.NoError(t, err)

				_, execution, err := deployer.DeployAndExecute(ctx, wf, "orchestrator replay: cancel")
				require.NoError(t, err)
				exID := execution.GetMetadata().GetId()

				waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
				_, err = waiter.WaitForPhase(ctx, exID,
					workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
				require.NoError(t, err)

				_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
					Id: exID, Reason: "orchestrator replay: cancel",
				})
				require.NoError(t, err)

				_, err = waiter.WaitForPhase(ctx, exID,
					workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
				require.NoError(t, err)
				return exID
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()

			executionID := tc.setup(t)
			orchID := harness.OrchestratorWorkflowID(executionID)

			// Export the outer orchestrator history (the Go workflow)
			orchFile := fmt.Sprintf("%s-orchestrator.json", tc.name)
			err := exporter.Export(ctx, orchID, "", orchFile)
			require.NoError(t, err, "export orchestrator history")

			// Also export the inner child history (the TS workflow)
			childID := harness.ChildWorkflowID(executionID)
			childFile := fmt.Sprintf("%s-child.json", tc.name)
			childErr := exporter.Export(ctx, childID, "", childFile)
			if childErr != nil {
				t.Logf("child history export skipped (may not exist for cancelled workflows): %v", childErr)
			}

			t.Logf("captured orchestrator history: %s/%s (execution=%s, phase=%s)",
				outputDir, orchFile, executionID, tc.expectedPhase.String())
		})
	}

	t.Logf("all orchestrator histories exported to %s — "+
		"replay these against InvokeWorkflowExecutionWorkflowImpl in backend unit tests "+
		"to detect non-determinism", outputDir)
}

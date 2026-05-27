//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	activityv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/activity/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowExecution_RecentsOrder_NewExecutionAppearsFirst verifies that
// the listRecentActivity RPC returns a freshly created workflow execution
// above an older execution that is already running and receiving status updates.
//
// This is the regression test for the bug where the unconditional
// statusAudit.updatedAt bump on every runner heartbeat caused running
// executions to perpetually sort above newly created ones.
func TestWorkflowExecution_RecentsOrder_NewExecutionAppearsFirst(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "recents-order", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Step 1: Deploy a blocking workflow (wait task = 60s) and start Execution A.
	// This execution will be RUNNING and receiving task-progress status updates.
	blockingWf, err := blockingWorkflowForRecents("recents-blocking-wf")
	require.NoError(t, err)

	_, execA, err := deployer.DeployAndExecute(ctx, blockingWf, "execution A for recents test")
	require.NoError(t, err)
	execAId := execA.GetMetadata().GetId()
	require.NotEmpty(t, execAId)

	// Wait for Execution A to reach RUNNING (confirms it has received at
	// least one status update from the runner, bumping its statusAudit).
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, execAId,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 60*time.Second)
	require.NoError(t, err, "Execution A should reach IN_PROGRESS")

	// Brief pause to ensure Execution A has received additional task-progress
	// updates beyond the initial phase transition.
	time.Sleep(2 * time.Second)

	// Step 2: Start Execution B (a fast workflow that completes immediately).
	// B was created AFTER A's last status update, so B must sort first in recents.
	fastWf := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "recents-fast-wf",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Fast workflow for recents ordering test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "recents-fast-wf",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "fastStep",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: mustStruct(map[string]any{"variables": map[string]any{"done": "true"}}),
				},
			},
		},
	}

	_, execB, err := deployer.DeployAndExecute(ctx, fastWf, "execution B for recents test")
	require.NoError(t, err)
	execBId := execB.GetMetadata().GetId()
	require.NotEmpty(t, execBId)

	// Brief pause for the create to propagate.
	time.Sleep(1 * time.Second)

	// Step 3: Call listRecentActivity and verify ordering.
	resp, err := clients.ActivityQuery.ListRecentActivity(ctx, &activityv1.ListRecentActivityRequest{
		PageSize: 30,
		Org:      "test-org",
	})
	require.NoError(t, err, "listRecentActivity should succeed")
	require.NotEmpty(t, resp.GetEntries(), "recents list should not be empty")

	// Find positions of both executions in the recents list.
	posA := -1
	posB := -1
	for i, entry := range resp.GetEntries() {
		if entry.GetId() == execAId {
			posA = i
		}
		if entry.GetId() == execBId {
			posB = i
		}
	}

	require.NotEqual(t, -1, posB,
		"Execution B (newly created) should appear in recents list; entries=%d", len(resp.GetEntries()))
	require.NotEqual(t, -1, posA,
		"Execution A (running) should appear in recents list; entries=%d", len(resp.GetEntries()))

	assert.Less(t, posB, posA,
		"Execution B (created after A) must appear before Execution A in recents; "+
			"posB=%d, posA=%d — this fails if statusAudit.updatedAt is bumped on every runner heartbeat",
		posB, posA)

	t.Logf("Recents order verified: Execution B at position %d, Execution A at position %d (total entries: %d)",
		posB, posA, len(resp.GetEntries()))
}

func blockingWorkflowForRecents(name string) (*workflowv1.Workflow, error) {
	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"started": "true"},
	})
	if err != nil {
		return nil, err
	}

	waitConfig, err := structpb.NewStruct(map[string]any{
		"duration": map[string]any{"seconds": float64(60)},
	})
	if err != nil {
		return nil, err
	}

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Blocking workflow for recents order test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "longWait",
					Kind:       workflowv1.WorkflowTaskKind_wait,
					TaskConfig: waitConfig,
				},
			},
		},
	}, nil
}

func mustStruct(m map[string]any) *structpb.Struct {
	s, err := structpb.NewStruct(m)
	if err != nil {
		panic(err)
	}
	return s
}

//go:build integration

package wfexecrouting

import (
	"context"
	"fmt"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/converter"
	"google.golang.org/protobuf/types/known/structpb"
)

// newMinimalWorkflow creates a trivial single-task workflow (set_vars) that
// completes instantly without LLM, DB, or HTTP calls.
func newMinimalWorkflow(name string) *workflowv1.Workflow {
	config, _ := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"status": "routing-test-completed",
		},
	})

	return &workflowv1.Workflow{
		ApiVersion: testAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  testOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: wfexec routing verification",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: testOrg,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setResult",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: config,
				},
			},
		},
	}
}

// workflowExecutionMemoQueue queries the Temporal dev server for the
// orchestrator workflow and extracts the runnerTaskQueue memo value.
func workflowExecutionMemoQueue(t *testing.T, ctx context.Context, executionID string) string {
	t.Helper()

	workflowID := fmt.Sprintf("stigmer/workflow-execution/invoke/%s", executionID)

	resp, err := temporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	require.NoError(t, err, "DescribeWorkflowExecution should succeed for workflow %s", workflowID)
	require.NotNil(t, resp.WorkflowExecutionInfo, "workflow execution info should be present")

	memo := resp.WorkflowExecutionInfo.GetMemo()
	require.NotNil(t, memo, "workflow memo should be present")

	payload, ok := memo.GetFields()["runnerTaskQueue"]
	require.True(t, ok, "memo should contain runnerTaskQueue key")

	var taskQueue string
	err = converter.GetDefaultDataConverter().FromPayload(payload, &taskQueue)
	require.NoError(t, err, "should decode runnerTaskQueue memo value")
	require.NotEmpty(t, taskQueue, "runnerTaskQueue should not be empty")

	return taskQueue
}

func TestWfExecRouting_WorkflowMemoHasExecutionQueue(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	deployer := harness.NewFixtureDeployer(clients, "memo-test", suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	wf := newMinimalWorkflow("wfexec-routing-memo-test")

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "routing memo test")
	require.NoError(t, err, "deploy and execute should succeed")

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)

	time.Sleep(2 * time.Second)

	taskQueue := workflowExecutionMemoQueue(t, ctx, executionID)

	expectedQueue := fmt.Sprintf("wfexec:%s", executionID)
	assert.Equal(t, expectedQueue, taskQueue,
		"workflow memo runnerTaskQueue should be wfexec:{executionId}")

	t.Logf("verified: execution %s → workflow memo runnerTaskQueue = %s", executionID, taskQueue)
}

func TestWfExecRouting_MultipleExecutionsGetDistinctQueues(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	deployer := harness.NewFixtureDeployer(clients, "multi-exec", suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	wf := newMinimalWorkflow("wfexec-routing-multi-test")

	_, exec1, err := deployer.DeployAndExecute(ctx, wf, "execution 1")
	require.NoError(t, err)

	_, exec2, err := deployer.DeployAndExecute(ctx, wf, "execution 2")
	require.NoError(t, err)

	time.Sleep(2 * time.Second)

	q1 := workflowExecutionMemoQueue(t, ctx, exec1.GetMetadata().GetId())
	q2 := workflowExecutionMemoQueue(t, ctx, exec2.GetMetadata().GetId())

	assert.NotEqual(t, q1, q2, "different executions should route to different queues")
	assert.Equal(t, fmt.Sprintf("wfexec:%s", exec1.GetMetadata().GetId()), q1)
	assert.Equal(t, fmt.Sprintf("wfexec:%s", exec2.GetMetadata().GetId()), q2)

	t.Logf("exec1 → %s, exec2 → %s", q1, q2)
}

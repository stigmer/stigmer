//go:build integration

package wfexecrouting

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/converter"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestAgentCallAffinity_ChildRoutesToParentQueue verifies that when a workflow
// contains a call:agent task and runs under execution routing
// (STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution, STIGMER_ACTIVITY_ROUTING=session),
// the child AgentExecution's activity_task_queue is set to the parent workflow's
// wfexec:{id} queue — NOT to session:{newSessionId}.
//
// This is the regression test for the bug where StripActivityTaskQueueStep
// cleared the sandbox affinity override for non-sandbox-token callers
// (e.g., desktop runners using PKCE auth), causing EnsureThread to be
// scheduled on an orphaned session:{id} queue with no worker.
func TestAgentCallAffinity_ChildRoutesToParentQueue(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	agent := createAffinityTestAgent(t, ctx, clients, "test-affinity-agent")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"message": "Reply with exactly: affinity-test-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "wfexec-agent-call-affinity-test",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call sandbox affinity under execution routing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "wfexec-agent-call-affinity-test",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callTestAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	deployer := harness.NewFixtureDeployer(clients, "affinity-test", suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "agent call affinity test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	expectedParentQueue := fmt.Sprintf("wfexec:%s", executionID)

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed")

	// Wait for the CallAgent activity to create the child AgentExecution.
	// The child agent execution will eventually fail (no LLM provider in
	// offline mode), but we only need it to reach the point where the
	// Temporal workflow is started with the activity queue memo.
	time.Sleep(15 * time.Second)

	agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	var childExecutionID string
	for _, ae := range agentExecs.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() != "" {
			childExecutionID = ae.GetMetadata().GetId()
			t.Logf("found child agent execution: id=%s, session=%s, parent_workflow=%s, activity_task_queue=%s",
				childExecutionID,
				ae.GetSpec().GetSessionId(),
				ae.GetSpec().GetParentWorkflowId(),
				ae.GetSpec().GetActivityTaskQueue())
			break
		}
	}

	require.NotEmpty(t, childExecutionID,
		"CallAgent activity should have created a child AgentExecution with parent_workflow_id set")

	childActivityQueue := agentExecutionMemoQueue(t, ctx, childExecutionID)

	assert.Equal(t, expectedParentQueue, childActivityQueue,
		"child agent execution's activityTaskQueue memo should match parent's wfexec:{id} queue, "+
			"not session:{newSessionId}. If this fails, StripActivityTaskQueueStep may be "+
			"incorrectly clearing the sandbox affinity override.")

	t.Logf("PASS: child agent execution %s routes to parent queue %s (not session-scoped)",
		childExecutionID, childActivityQueue)
}

// agentExecutionMemoQueue queries the Temporal dev server for the agent
// execution orchestrator workflow and extracts the activityTaskQueue memo value.
func agentExecutionMemoQueue(t *testing.T, ctx context.Context, executionID string) string {
	t.Helper()

	workflowID := fmt.Sprintf("stigmer/agent-execution/invoke/%s", executionID)

	resp, err := temporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	require.NoError(t, err, "DescribeWorkflowExecution should succeed for workflow %s", workflowID)
	require.NotNil(t, resp.WorkflowExecutionInfo, "workflow execution info should be present")

	memo := resp.WorkflowExecutionInfo.GetMemo()
	require.NotNil(t, memo, "workflow memo should be present")

	payload, ok := memo.GetFields()["activityTaskQueue"]
	require.True(t, ok, "memo should contain activityTaskQueue key")

	var taskQueue string
	err = converter.GetDefaultDataConverter().FromPayload(payload, &taskQueue)
	require.NoError(t, err, "should decode activityTaskQueue memo value")
	require.NotEmpty(t, taskQueue, "activityTaskQueue should not be empty")

	return taskQueue
}

// TestAgentCallAffinity_CursorRoutesToParentQueue is the cursor harness
// counterpart of TestAgentCallAffinity_ChildRoutesToParentQueue. It verifies
// that a workflow agent_call with harness:cursor under execution routing
// dispatches ExecuteCursor to the parent wfexec:{id} queue and that the
// unified runner actually picks it up.
//
// No Cursor API key is required. Without one, ExecuteCursor fails with an
// expected SDK error. The critical assertion is that the child agent execution
// reaches a terminal state (FAILED) rather than timing out on ScheduleToStart
// — proving the activity was dispatched and picked up on the wfexec queue.
func TestAgentCallAffinity_CursorRoutesToParentQueue(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	agent := createAffinityTestAgent(t, ctx, clients, "test-cursor-affinity-agent")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"message": "Reply with exactly: cursor-affinity-test-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "wfexec-cursor-call-affinity-test",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor agent_call sandbox affinity under execution routing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "wfexec-cursor-call-affinity-test",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callCursorAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	deployer := harness.NewFixtureDeployer(clients, "cursor-affinity-test", suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor agent call affinity test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	expectedParentQueue := fmt.Sprintf("wfexec:%s", executionID)

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed")

	// Wait for CallAgent to create the child AgentExecution with cursor harness.
	expectedParentWorkflowID := fmt.Sprintf("workflow-exec-%s", executionID)
	time.Sleep(15 * time.Second)

	agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	var childExecutionID string
	for _, ae := range agentExecs.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() == expectedParentWorkflowID {
			childExecutionID = ae.GetMetadata().GetId()
			t.Logf("found child agent execution: id=%s, session=%s, parent_workflow=%s, activity_task_queue=%s",
				childExecutionID,
				ae.GetSpec().GetSessionId(),
				ae.GetSpec().GetParentWorkflowId(),
				ae.GetSpec().GetActivityTaskQueue())
			break
		}
	}

	require.NotEmpty(t, childExecutionID,
		"CallAgent activity should have created a child AgentExecution (cursor harness) with parent_workflow_id=%s",
		expectedParentWorkflowID)

	// Verify queue affinity: child agent execution should route to parent wfexec queue.
	childActivityQueue := agentExecutionMemoQueue(t, ctx, childExecutionID)
	assert.Equal(t, expectedParentQueue, childActivityQueue,
		"cursor child agent execution's activityTaskQueue memo should match parent's wfexec:{id} queue")

	// Verify the runner picks up ExecuteCursor. Without a Cursor API key,
	// the execution should fail (not timeout). A timeout here means the
	// runner is NOT polling the wfexec queue for ExecuteCursor activities.
	agentWaiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := agentWaiter.WaitForTerminal(ctx, childExecutionID, 90*time.Second)
	require.NoError(t, err,
		"child agent execution should reach terminal state; "+
			"timeout means ExecuteCursor was NOT picked up on the wfexec queue")

	phase := result.GetStatus().GetPhase()
	t.Logf("child agent execution %s reached phase %s on queue %s",
		childExecutionID, phase.String(), childActivityQueue)

	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"cursor agent execution should FAIL without API key "+
			"(proves ExecuteCursor was dispatched and picked up on wfexec queue)")
}

func createAffinityTestAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent for sandbox affinity verification",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	return created
}

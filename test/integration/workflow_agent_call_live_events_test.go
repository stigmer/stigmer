//go:build integration

package integration

import (
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

// TestWorkflowAgentCall_LiveEventsEmitted verifies the complete event lifecycle
// for an agent_call task: task_started, agent_call_started, and a terminal event
// must all appear in the subscribeEvents stream.
//
// This is the foundational diagnostic test for the agent call live experience
// pipeline. If it fails, the symptom is exactly what users see: "Waiting for
// agent to start..." forever in the desktop app.
func TestWorkflowAgentCall_LiveEventsEmitted(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "live-events", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-live-events-agent",
		"You are a helpful assistant. Reply briefly with exactly: live-events-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Reply with exactly: live-events-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-live-events",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call live events emitted",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-live-events",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "live events test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err, "event collector should start successfully")
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")
	t.Logf("execution reached terminal phase: %s", result.GetStatus().GetPhase().String())

	// Give the event stream a moment to flush any trailing events after terminal phase.
	time.Sleep(2 * time.Second)

	allEvents := collector.AllEvents()
	t.Logf("collected %d events total", len(allEvents))
	for i, evt := range allEvents {
		t.Logf("  event[%d]: type=%s task=%q seq=%d",
			i, evt.GetEventType().String(), evt.GetTaskName(), evt.GetSequenceNumber())
	}

	require.NotEmpty(t, allEvents, "event stream should have delivered at least one event")

	taskStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_task_started)
	agentStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_agent_call_started)
	execStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_execution_started)

	assert.NotEmpty(t, execStarted,
		"execution_started event must be present")
	assert.NotEmpty(t, taskStarted,
		"task_started event must be present for the agent_call task")
	assert.NotEmpty(t, agentStarted,
		"agent_call_started event must be present")

	if len(agentStarted) > 0 {
		started := agentStarted[0]
		assert.Equal(t, "callAgent", started.GetTaskName(),
			"agent_call_started must reference the correct task")
		payload := started.GetAgentCallStarted()
		assert.NotNil(t, payload, "agent_call_started should have a payload")
		if payload != nil {
			assert.NotEmpty(t, payload.GetAgentSlug(),
				"agent_call_started must carry the agent slug")
		}
	}

	// Verify event ordering: execution_started < task_started < agent_call_started
	if len(execStarted) > 0 && len(taskStarted) > 0 {
		assert.Less(t, execStarted[0].GetSequenceNumber(), taskStarted[0].GetSequenceNumber(),
			"execution_started must precede task_started")
	}
	if len(taskStarted) > 0 && len(agentStarted) > 0 {
		assert.Less(t, taskStarted[0].GetSequenceNumber(), agentStarted[0].GetSequenceNumber(),
			"task_started must precede agent_call_started")
	}
}

// TestWorkflowAgentCall_ProgressEventsHaveChildExecutionId verifies that
// agent_call_progress events carry a non-empty child_execution_id, which is
// the critical field that enables the live transcript in the inspector's Agent tab.
//
// The childExecutionId arrives via the child_execution_started Temporal signal
// from InvokeAgentExecutionWorkflow → orchestrateAgentCall → emitProgress.
func TestWorkflowAgentCall_ProgressEventsHaveChildExecutionId(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "child-id", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-child-id-agent",
		"You are a helpful assistant. Reply briefly with exactly: child-id-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Reply with exactly: child-id-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-child-exec-id",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call progress carries childExecutionId",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-child-exec-id",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "child exec id test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err)
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")

	time.Sleep(2 * time.Second)

	allEvents := collector.AllEvents()
	t.Logf("collected %d events total", len(allEvents))

	// Find the childExecutionId from any agent call event (progress or completed).
	var childExecID string
	for _, evt := range allEvents {
		switch evt.GetEventType() {
		case workflowexecutionv1.WorkflowEventType_agent_call_progress:
			if id := evt.GetAgentCallProgress().GetChildExecutionId(); id != "" {
				childExecID = id
			}
		case workflowexecutionv1.WorkflowEventType_agent_call_completed:
			if p := evt.GetAgentCallCompleted(); p != nil && p.GetChildExecutionId() != "" {
				childExecID = p.GetChildExecutionId()
			}
		}
	}

	// Log all event types for diagnosis regardless of pass/fail.
	for i, evt := range allEvents {
		t.Logf("  event[%d]: type=%s task=%q seq=%d",
			i, evt.GetEventType().String(), evt.GetTaskName(), evt.GetSequenceNumber())
	}

	require.NotEmpty(t, childExecID,
		"at least one agent_call_progress or agent_call_completed event must carry a non-empty child_execution_id; "+
			"this is the field that enables the live transcript in the Agent tab")

	t.Logf("childExecutionId found: %s", childExecID)

	// Verify the child AgentExecution actually exists and references the parent.
	childExec, err := clients.AgentExecutionQuery.Get(ctx,
		&agentexecv1.AgentExecutionId{Value: childExecID})
	require.NoError(t, err, "child AgentExecution should be fetchable by ID")
	assert.NotEmpty(t, childExec.GetSpec().GetParentWorkflowId(),
		"child AgentExecution must have parentWorkflowId set")

	t.Logf("child AgentExecution verified: id=%s, parentWorkflowId=%s",
		childExec.GetMetadata().GetId(),
		childExec.GetSpec().GetParentWorkflowId())

	// If progress events exist, verify they all reference the same child.
	progressEvents := collector.EventsByType(workflowexecutionv1.WorkflowEventType_agent_call_progress)
	for i, evt := range progressEvents {
		p := evt.GetAgentCallProgress()
		if p.GetChildExecutionId() != "" {
			assert.Equal(t, childExecID, p.GetChildExecutionId(),
				"progress event[%d] child_execution_id must be consistent", i)
		}
	}
}

// TestWorkflowAgentCall_EventsPersistedAndStreamable verifies that events
// survive persistence and can be retrieved via getEventLog after the execution
// completes. This confirms the persistence pipeline (PersistEventsStep in
// update_status) is working correctly.
func TestWorkflowAgentCall_EventsPersistedAndStreamable(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "persist", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-persist-agent",
		"You are a helpful assistant. Reply briefly with exactly: persist-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Reply with exactly: persist-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-event-persist",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: events persisted and retrievable via getEventLog",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-event-persist",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "event persist test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err)
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")

	time.Sleep(2 * time.Second)

	streamEvents := collector.AllEvents()
	t.Logf("stream collected %d events", len(streamEvents))

	// Now fetch via getEventLog (batch API) and compare.
	logResp, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed for a terminal execution")

	batchEvents := logResp.GetEvents()
	t.Logf("getEventLog returned %d events", len(batchEvents))

	require.NotEmpty(t, batchEvents,
		"getEventLog must return events for a completed execution; "+
			"empty means PersistEventsStep silently failed")

	// Verify sequence numbers are monotonically increasing.
	var prevSeq uint64
	for i, evt := range batchEvents {
		seq := evt.GetSequenceNumber()
		assert.Greater(t, seq, prevSeq,
			"event[%d] sequence %d must be > previous %d", i, seq, prevSeq)
		prevSeq = seq
	}

	// Verify at minimum: execution_started + task_started + agent_call_started exist in batch.
	batchTypes := make(map[workflowexecutionv1.WorkflowEventType]int)
	for _, evt := range batchEvents {
		batchTypes[evt.GetEventType()]++
	}

	assert.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_execution_started,
		"batch must contain execution_started")
	assert.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_task_started,
		"batch must contain task_started")
	assert.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_agent_call_started,
		"batch must contain agent_call_started")

	// Stream and batch event counts should be close (stream might miss events
	// that arrive after the stream closes but before the batch fetch).
	if len(streamEvents) > 0 {
		assert.InDelta(t, len(batchEvents), len(streamEvents), 3,
			"stream (%d) and batch (%d) event counts should be approximately equal",
			len(streamEvents), len(batchEvents))
	}

	t.Logf("event persistence verified: stream=%d, batch=%d, types=%v",
		len(streamEvents), len(batchEvents), batchTypes)
}

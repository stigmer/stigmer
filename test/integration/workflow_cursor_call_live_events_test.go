//go:build integration

package integration

import (
	"strings"
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

// TestWorkflowCursorCall_AgentCallStartedEmittedBeforeFailure verifies that
// agent_call_started is emitted BEFORE the cursor harness dispatches to
// the Cursor SDK. This event fires in CallAgentTaskBuilder.executeAgentCall()
// prior to ctx.callAgent(), so it must appear even when the Cursor SDK fails
// (e.g., no CURSOR_API_KEY).
//
// This is the offline diagnostic for the missing Agent tab: if this test
// fails, agent_call_started is never emitted for cursor-harness tasks,
// which explains why the Agent tab never appears.
//
// Does NOT require CURSOR_API_KEY — the test asserts on events emitted
// before the harness-specific failure.
func TestWorkflowCursorCall_AgentCallStartedEmittedBeforeFailure(t *testing.T) {
	requireCursorCallOfflinePrereqs(t)

	ctx, cancel := harness.TestContext(t, 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-evt-offline", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-evt-offline-agent",
		"You are a test agent. Reply briefly.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with: cursor-event-test",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-evt-offline",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor harness agent_call_started emitted before failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-evt-offline",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "cursorCall",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor event offline test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err, "event collector should start successfully")
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase (FAILED without API key)")
	t.Logf("execution reached terminal phase: %s", result.GetStatus().GetPhase().String())

	time.Sleep(2 * time.Second)

	allEvents := collector.AllEvents()
	t.Logf("collected %d events total", len(allEvents))
	for i, evt := range allEvents {
		t.Logf("  event[%d]: type=%s task=%q seq=%d",
			i, evt.GetEventType().String(), evt.GetTaskName(), evt.GetSequenceNumber())
	}

	require.NotEmpty(t, allEvents, "event stream should have delivered at least one event")

	execStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_execution_started)
	taskStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_task_started)
	agentStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_agent_call_started)

	assert.NotEmpty(t, execStarted,
		"execution_started event must be present")
	assert.NotEmpty(t, taskStarted,
		"task_started event must be present for the cursor-harness agent_call task")

	// This is the key assertion: agent_call_started must fire before the Cursor
	// SDK dispatch. If this fails, the runner's CallAgentTaskBuilder is not
	// emitting agent_call_started for cursor-harness tasks.
	require.NotEmpty(t, agentStarted,
		"agent_call_started event must be present even when the cursor harness fails; "+
			"it is emitted by CallAgentTaskBuilder.executeAgentCall() BEFORE ctx.callAgent(); "+
			"if missing, the Agent tab in the execution inspector will never appear")

	started := agentStarted[0]
	assert.Equal(t, "cursorCall", started.GetTaskName(),
		"agent_call_started must reference the correct task name")
	payload := started.GetAgentCallStarted()
	require.NotNil(t, payload, "agent_call_started should have a payload")
	assert.NotEmpty(t, payload.GetAgentSlug(),
		"agent_call_started must carry the agent slug")

	if len(execStarted) > 0 && len(taskStarted) > 0 {
		assert.Less(t, execStarted[0].GetSequenceNumber(), taskStarted[0].GetSequenceNumber(),
			"execution_started must precede task_started")
	}
	if len(taskStarted) > 0 && len(agentStarted) > 0 {
		assert.Less(t, taskStarted[0].GetSequenceNumber(), agentStarted[0].GetSequenceNumber(),
			"task_started must precede agent_call_started")
	}
}

// TestWorkflowCursorCall_LiveEventsEmitted verifies the complete event
// lifecycle for a cursor-harness agent_call task: task_started,
// agent_call_started, agent_call_completed, and task_completed must all
// appear in the subscribeEvents stream.
//
// This is the cursor-harness counterpart to TestWorkflowAgentCall_LiveEventsEmitted
// (which tests native harness). If this test fails but the native test passes,
// the cursor harness has a harness-specific event emission bug.
//
// Requires CURSOR_API_KEY for full execution.
func TestWorkflowCursorCall_LiveEventsEmitted(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-live-evt", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-live-evt-agent",
		"You are a helpful assistant. Reply briefly with exactly: cursor-live-events-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: cursor-live-events-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-live-events",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor harness agent_call full event lifecycle",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-live-events",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "cursorCall",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor live events test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err, "event collector should start successfully")
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 5*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")
	t.Logf("execution reached terminal phase: %s", result.GetStatus().GetPhase().String())

	time.Sleep(2 * time.Second)

	allEvents := collector.AllEvents()
	t.Logf("collected %d events total", len(allEvents))
	for i, evt := range allEvents {
		t.Logf("  event[%d]: type=%s task=%q seq=%d",
			i, evt.GetEventType().String(), evt.GetTaskName(), evt.GetSequenceNumber())
	}

	require.NotEmpty(t, allEvents, "event stream should have delivered at least one event")

	execStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_execution_started)
	taskStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_task_started)
	agentStarted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_agent_call_started)
	agentCompleted := collector.EventsByType(workflowexecutionv1.WorkflowEventType_agent_call_completed)

	assert.NotEmpty(t, execStarted, "execution_started event must be present")
	assert.NotEmpty(t, taskStarted, "task_started event must be present")
	require.NotEmpty(t, agentStarted,
		"agent_call_started event must be present for cursor-harness agent_call tasks; "+
			"without this event the Agent tab in the execution inspector will not appear")

	started := agentStarted[0]
	assert.Equal(t, "cursorCall", started.GetTaskName(),
		"agent_call_started must reference the correct task name")
	payload := started.GetAgentCallStarted()
	require.NotNil(t, payload, "agent_call_started must have a payload")
	assert.NotEmpty(t, payload.GetAgentSlug(),
		"agent_call_started must carry the agent slug")

	if result.GetStatus().GetPhase() == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
		require.NotEmpty(t, agentCompleted,
			"agent_call_completed event must be present when execution succeeds")
		completed := agentCompleted[0]
		assert.Equal(t, "cursorCall", completed.GetTaskName(),
			"agent_call_completed must reference the correct task name")
		cp := completed.GetAgentCallCompleted()
		require.NotNil(t, cp, "agent_call_completed must have a payload")
		assert.Empty(t, cp.GetError(),
			"agent_call_completed error should be empty on success")
		assert.Greater(t, cp.GetDurationMs(), int64(0),
			"agent_call_completed must report a positive duration")
	}

	// Event ordering: execution_started < task_started < agent_call_started
	if len(execStarted) > 0 && len(taskStarted) > 0 {
		assert.Less(t, execStarted[0].GetSequenceNumber(), taskStarted[0].GetSequenceNumber(),
			"execution_started must precede task_started")
	}
	if len(taskStarted) > 0 && len(agentStarted) > 0 {
		assert.Less(t, taskStarted[0].GetSequenceNumber(), agentStarted[0].GetSequenceNumber(),
			"task_started must precede agent_call_started")
	}
}

// TestWorkflowCursorCall_EventsPersistedViaGetEventLog verifies that
// cursor-harness agent_call events survive persistence and can be
// retrieved via the getEventLog batch API after execution completes.
//
// This is the persistence counterpart to TestWorkflowCursorCall_LiveEventsEmitted.
// If live events pass but this test fails, the server's PersistEventsStep
// is dropping agent_call events.
//
// Requires CURSOR_API_KEY for a successful execution with all event types.
func TestWorkflowCursorCall_EventsPersistedViaGetEventLog(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-persist", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-persist-agent",
		"You are a helpful assistant. Reply briefly with exactly: cursor-persist-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: cursor-persist-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-event-persist",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor harness events persisted via getEventLog",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-event-persist",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "cursorCall",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor event persist test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err)
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTerminal(ctx, executionID, 5*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")

	time.Sleep(2 * time.Second)

	streamEvents := collector.AllEvents()
	t.Logf("stream collected %d events", len(streamEvents))

	logResp, err := clients.ExecutionQuery.GetEventLog(ctx,
		&workflowexecutionv1.GetEventLogRequest{
			ExecutionId:   executionID,
			AfterSequence: 0,
		})
	require.NoError(t, err, "getEventLog should succeed for a terminal execution")

	batchEvents := logResp.GetEvents()
	t.Logf("getEventLog returned %d events", len(batchEvents))
	for i, evt := range batchEvents {
		t.Logf("  batch[%d]: type=%s task=%q seq=%d",
			i, evt.GetEventType().String(), evt.GetTaskName(), evt.GetSequenceNumber())
	}

	require.NotEmpty(t, batchEvents,
		"getEventLog must return events for a terminal execution")

	var prevSeq uint64
	for i, evt := range batchEvents {
		seq := evt.GetSequenceNumber()
		assert.Greater(t, seq, prevSeq,
			"event[%d] sequence %d must be > previous %d", i, seq, prevSeq)
		prevSeq = seq
	}

	batchTypes := make(map[workflowexecutionv1.WorkflowEventType]int)
	for _, evt := range batchEvents {
		batchTypes[evt.GetEventType()]++
	}

	assert.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_execution_started,
		"persisted event log must contain execution_started")
	assert.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_task_started,
		"persisted event log must contain task_started")
	require.Contains(t, batchTypes, workflowexecutionv1.WorkflowEventType_agent_call_started,
		"persisted event log must contain agent_call_started; "+
			"if missing, PersistEventsStep is dropping cursor-harness agent_call events")

	if len(streamEvents) > 0 {
		assert.InDelta(t, len(batchEvents), len(streamEvents), 3,
			"stream (%d) and batch (%d) event counts should be approximately equal",
			len(streamEvents), len(batchEvents))
	}

	t.Logf("cursor event persistence verified: stream=%d, batch=%d, types=%v",
		len(streamEvents), len(batchEvents), batchTypes)
}

// TestWorkflowAgentCall_TaskSnapshotMetadata_AgentExecutionId verifies that
// after an agent_call task completes, the task snapshot in
// WorkflowExecutionStatus.tasks[] contains metadata.agent_execution_id.
//
// This metadata is set by the do-executor after the task completes and is
// the fallback data source for the Agent tab when event-based data is
// unavailable.
func TestWorkflowAgentCall_TaskSnapshotMetadata_AgentExecutionId(t *testing.T) {
	requireAgentCallPrereqs(t)

	type subtest struct {
		name       string
		harness    string
		skipFunc   func(t *testing.T)
		taskName   string
	}

	subtests := []subtest{
		{
			name:     "native harness",
			harness:  "",
			skipFunc: func(t *testing.T) { requireLLMAvailable(t) },
			taskName: "callAgentNative",
		},
		{
			name:     "cursor harness",
			harness:  "cursor",
			skipFunc: requireCursorCallProviderPrereqs,
			taskName: "callAgentCursor",
		},
	}

	for _, st := range subtests {
		t.Run(st.name, func(t *testing.T) {
			st.skipFunc(t)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)
			deployer := harness.NewFixtureDeployer(clients, "meta-"+st.taskName, suiteLogger)
			defer deployer.Cleanup(ctx)

			createFn := createTestAgent
			if st.harness == "cursor" {
				createFn = createTestAgentForCursor
			}
			agent := createFn(t, ctx, clients, "test-meta-"+st.taskName+"-agent",
				"You are a helpful assistant. Reply briefly with exactly: metadata-ok")

			config := map[string]any{
				"agent":   agent.GetMetadata().GetSlug(),
				"org":     harness.TestOrg,
				"message": "Reply with exactly: metadata-ok",
			}
			if st.harness != "" {
				config["harness"] = st.harness
			}

			taskConfig, err := structpb.NewStruct(config)
			require.NoError(t, err)

			wfName := "integration-test-meta-" + st.taskName
			workflow := &workflowv1.Workflow{
				ApiVersion: harness.TestAPIVersion,
				Kind:       "Workflow",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: wfName,
					Org:  harness.TestOrg,
				},
				Spec: &workflowv1.WorkflowSpec{
					Description: "Integration test: task snapshot metadata contains agent_execution_id (" + st.name + ")",
					Document: &workflowv1.WorkflowDocument{
						Dsl:       "1.0.0",
						Namespace: harness.TestOrg,
						Name:      wfName,
						Version:   "1.0.0",
					},
					Tasks: []*workflowv1.WorkflowTask{
						{
							Name:       st.taskName,
							Kind:       workflowv1.WorkflowTaskKind_agent_call,
							TaskConfig: taskConfig,
						},
					},
				},
			}

			_, execution, err := deployer.DeployAndExecute(ctx, workflow, "metadata test "+st.name)
			require.NoError(t, err)
			executionID := execution.GetMetadata().GetId()
			require.NotEmpty(t, executionID)
			t.Logf("workflow execution created: id=%s", executionID)

			waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, executionID,
				workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
			require.NoError(t, err, "execution should reach COMPLETED phase")
			harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

			var task *workflowexecutionv1.WorkflowTask
			for _, tk := range result.GetStatus().GetTasks() {
				if tk.GetTaskName() == st.taskName {
					task = tk
					break
				}
			}
			require.NotNilf(t, task, "task %q must be present in execution status", st.taskName)

			meta := task.GetMetadata()
			require.NotNilf(t, meta, "task %q metadata must not be nil", st.taskName)

			fields := meta.GetFields()
			require.Containsf(t, fields, "agent_execution_id",
				"task %q metadata must contain agent_execution_id; "+
					"this is set by the do-executor after agent_call completion and is the "+
					"fallback data source for the Agent tab", st.taskName)

			aexID := fields["agent_execution_id"].GetStringValue()
			require.NotEmpty(t, aexID,
				"agent_execution_id must be a non-empty string")
			assert.Truef(t, strings.HasPrefix(aexID, "aex_"),
				"agent_execution_id %q must start with 'aex_' prefix", aexID)

			t.Logf("task %q metadata.agent_execution_id = %s", st.taskName, aexID)

			childExec, err := clients.AgentExecutionQuery.Get(ctx,
				&agentexecv1.AgentExecutionId{Value: aexID})
			require.NoError(t, err, "child AgentExecution should be fetchable by metadata ID")
			assert.NotEmpty(t, childExec.GetMetadata().GetId(),
				"child AgentExecution must exist and have an ID")

			t.Logf("child AgentExecution verified via metadata: id=%s", childExec.GetMetadata().GetId())
		})
	}
}

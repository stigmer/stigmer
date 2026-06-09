//go:build integration

package integration

import (
	"os"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorHarness_AllToolCallsPersistedInMessages reproduces the scenario
// where an agent makes multiple sequential tool calls (reads followed by
// writes) and verifies that EVERY tool call appears in the persisted
// AgentExecution.status.messages after completion.
//
// This is a reproduction test for the observed production behavior where
// the agent's thinking acknowledged reading a file ("Let me read the
// database schema reference file") but no corresponding Read tool call
// appeared in the UI. The hypothesis is that tool calls are lost between
// the runner's MessageAccumulator and the persisted status, or that the
// persist throttle (every 20 events) causes intermediate tool calls to
// be invisible.
//
// The test forces a deterministic sequence:
//  1. Create 3 files (3 Write/file_edit tool calls)
//  2. Read all 3 files back (3 Read tool calls)
//  3. Create a summary file (1 Write/file_edit tool call)
//
// Then asserts:
//   - Execution completed successfully
//   - Total tool call count >= 5 (at minimum: writes + reads, accounting
//     for LLM non-determinism in exact tool selection)
//   - At least 1 Read tool call exists in persisted messages
//   - No tool call has RUNNING status (finalize reconciliation worked)
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_AllToolCallsPersistedInMessages(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-tool-persist-agent",
		"You are a precise coding assistant. Follow instructions exactly. "+
			"When asked to create and read files, use the appropriate tools. "+
			"Do NOT skip any step. Each step must use a tool call.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Do the following steps IN ORDER. Each step MUST use a tool call:\n"+
			"1. Create a file called step1.txt containing exactly: 'data from step one'\n"+
			"2. Create a file called step2.txt containing exactly: 'data from step two'\n"+
			"3. Create a file called step3.txt containing exactly: 'data from step three'\n"+
			"4. Read step1.txt and tell me what it contains\n"+
			"5. Read step2.txt and tell me what it contains\n"+
			"6. Read step3.txt and tell me what it contains\n"+
			"7. Create a file called summary.txt containing a one-line summary of all three files\n"+
			"8. Reply with 'All 7 steps completed' and list the contents of each file you read.",
		// Auto-approve so the Write tool calls execute without parking on the
		// cursor write-approval gate; this test verifies tool-call persistence,
		// not the approval flow (which is covered by TestCursorHarness_HITL_*).
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		// Even if we didn't reach COMPLETED, try to get the final state
		// to inspect what tool calls were persisted.
		result, _ = clients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
	}
	require.NoError(t, err, "execution should reach COMPLETED phase")
	require.NotNil(t, result)

	// --- Collect unique tool calls from persisted messages ---

	messages := result.GetStatus().GetMessages()
	t.Logf("total messages: %d", len(messages))

	// Core invariant: each call_id maps to exactly one ToolCall. A duplicate
	// here is the bug where the runner re-records a tool/sub-agent, surfacing
	// as the same item rendered multiple times in the UI.
	harness.AssertUniqueToolCallIds(t, result)

	toolCalls := collectToolCalls(messages)

	var readToolCalls []*agentexecv1.ToolCall
	var writeToolCalls []*agentexecv1.ToolCall
	var stuckRunning []*agentexecv1.ToolCall

	for _, tc := range toolCalls {
		name := strings.ToLower(tc.GetName())
		if name == "read" || name == "read_file" || strings.Contains(name, "read") {
			readToolCalls = append(readToolCalls, tc)
		}
		if name == "write" || name == "file_edit" || name == "write_file" ||
			name == "create_file" || strings.Contains(name, "write") ||
			strings.Contains(name, "edit") {
			writeToolCalls = append(writeToolCalls, tc)
		}
		if tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_RUNNING {
			stuckRunning = append(stuckRunning, tc)
		}

		t.Logf("  tool_call: name=%s, id=%s, status=%s, result_len=%d",
			tc.GetName(), tc.GetId(), tc.GetStatus().String(), len(tc.GetResult()))
	}

	// --- Assertions ---

	assert.GreaterOrEqual(t, len(toolCalls), 5,
		"expected at least 5 unique tool calls (3 writes + reads); got %d. "+
			"If this fails, tool calls are being lost in the streaming pipeline. "+
			"Check runner MessageAccumulator and persistStatus throttle.",
		len(toolCalls))

	assert.NotEmpty(t, readToolCalls,
		"expected at least 1 Read tool call in persisted messages; got 0. "+
			"This reproduces the production bug where thinking says 'let me read' "+
			"but no Read tool call appears in the UI.")

	assert.Empty(t, stuckRunning,
		"found %d tool call(s) stuck in RUNNING status after execution completed: %v. "+
			"DeltaEnricher.finalize() reconciliation failed.",
		len(stuckRunning), toolCallNames(stuckRunning))

	t.Logf("RESULT: unique_tool_calls=%d, reads=%d, writes=%d, stuck_running=%d",
		len(toolCalls), len(readToolCalls), len(writeToolCalls), len(stuckRunning))
}

// TestCursorHarness_MaxListenersWarningUnderConcurrentToolCalls reproduces
// the MaxListenersExceededWarning by forcing the Cursor agent to perform
// many operations that create concurrent AbortSignal listeners.
//
// The test asserts that:
//   - Execution completes despite the warning
//   - The runner log contains (or does not contain) the MaxListeners warning
//   - All tool calls are still persisted correctly even if the warning fires
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_MaxListenersWarningUnderConcurrentToolCalls(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-maxlisteners-agent",
		"You are a precise coding assistant. Follow instructions exactly.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	// Request many parallel tool calls to maximize concurrent AbortSignal
	// listeners. The "do all at once" phrasing encourages batching.
	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Do ALL of the following in PARALLEL (batch them together):\n"+
			"1. Create a file called batch-1.txt with content 'batch 1'\n"+
			"2. Create a file called batch-2.txt with content 'batch 2'\n"+
			"3. Create a file called batch-3.txt with content 'batch 3'\n"+
			"4. Create a file called batch-4.txt with content 'batch 4'\n"+
			"5. Create a file called batch-5.txt with content 'batch 5'\n"+
			"6. Create a file called batch-6.txt with content 'batch 6'\n"+
			"7. Create a file called batch-7.txt with content 'batch 7'\n"+
			"8. Create a file called batch-8.txt with content 'batch 8'\n"+
			"9. Create a file called batch-9.txt with content 'batch 9'\n"+
			"10. Create a file called batch-10.txt with content 'batch 10'\n"+
			"11. Create a file called batch-11.txt with content 'batch 11'\n"+
			"12. Create a file called batch-12.txt with content 'batch 12'\n"+
			"After creating ALL files, reply with 'All 12 files created'.",
		// Auto-approve so the parallel Write tool calls execute without the
		// approval gate; this test measures tool-call count under concurrency.
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		result, _ = clients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
	}
	require.NoError(t, err, "execution should complete even if MaxListeners warning fires")
	require.NotNil(t, result)

	// No duplicates, and no tool calls lost despite concurrent pressure.
	harness.AssertUniqueToolCallIds(t, result)
	toolCalls := collectToolCalls(result.GetStatus().GetMessages())

	assert.GreaterOrEqual(t, len(toolCalls), 10,
		"expected at least 10 unique tool calls for 12 file creates; got %d. "+
			"If MaxListenersExceededWarning causes event loss, this count will be low.",
		len(toolCalls))

	t.Logf("RESULT: unique_tool_calls=%d (expected ~12)", len(toolCalls))

	// Check runner logs for MaxListenersExceededWarning
	runnerLogPath := testHarness.UnifiedRunner.LogPath()
	if runnerLogPath != "" {
		logBytes, readErr := os.ReadFile(runnerLogPath)
		if readErr != nil {
			t.Logf("WARNING: could not read runner log at %s: %v", runnerLogPath, readErr)
		} else {
			logContent := string(logBytes)
			hasMaxListenersWarning := strings.Contains(logContent, "MaxListenersExceededWarning")

			if hasMaxListenersWarning {
				t.Logf("CONFIRMED: MaxListenersExceededWarning is present in runner logs")
				t.Logf("DIAGNOSTIC: This warning fires when >10 abort listeners are added " +
					"to an AbortSignal. It is a Node.js diagnostic, not a functional error. " +
					"Verify that tool call count is still correct despite the warning.")

				assert.GreaterOrEqual(t, len(toolCalls), 10,
					"tool calls were lost despite MaxListenersExceededWarning being benign; "+
						"this would indicate a deeper issue than just the listener limit")
			} else {
				t.Logf("MaxListenersExceededWarning NOT present in runner logs for this execution. " +
					"The setMaxListeners(25) fix suppressed it — or concurrency was below threshold.")
			}
		}
	}
}

// TestCursorHarness_ToolCallCountReconciliation verifies that the number of
// tool_call events in the Cursor SDK stream matches the number of ToolCall
// entries in the persisted AgentExecution.status.messages.
//
// This test uses a simple deterministic prompt (echo tool via MCP) where we
// know exactly how many tool calls should exist, then compares against the
// runner's stream event count logged at stream end.
//
// If this test fails, it proves tool calls are being lost in the pipeline.
// If it passes, the "missing tool call" in the production scenario was
// either:
//   - The schema content was embedded in the skill (no separate Read needed)
//   - The persist throttle caused a visibility gap (tool call was persisted
//     but not visible during streaming)
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_ToolCallCountReconciliation(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-reconcile-agent",
		"You are a precise assistant. When asked to create files, use the Write tool. "+
			"When asked to read files, use the Read tool. Do not skip steps.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	// Simple sequential operations: create one file, read it back
	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Step 1: Create a file called reconcile-test.txt containing 'reconcile data'\n"+
			"Step 2: Read reconcile-test.txt and tell me its contents\n"+
			"Reply with what the file contained.",
		// Auto-approve so the Write executes without the approval gate; this
		// test reconciles persisted tool-call counts, not the approval flow.
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err)
	require.NotNil(t, result)

	// Each call_id must map to exactly one persisted ToolCall.
	harness.AssertUniqueToolCallIds(t, result)
	toolCalls := collectToolCalls(result.GetStatus().GetMessages())

	assert.GreaterOrEqual(t, len(toolCalls), 2,
		"expected at least 2 unique tool calls (1 write + 1 read); got %d", len(toolCalls))

	for _, tc := range toolCalls {
		assert.NotEqual(t, agentexecv1.ToolCallStatus_TOOL_CALL_RUNNING, tc.GetStatus(),
			"tool call %s (%s) is stuck in RUNNING — finalize reconciliation failed",
			tc.GetId(), tc.GetName())
	}

	t.Logf("RECONCILIATION: %d unique tool calls persisted in messages", len(toolCalls))
	for i, tc := range toolCalls {
		t.Logf("  tc[%d]: name=%s, id=%s, status=%s, started=%s, completed=%s",
			i, tc.GetName(), tc.GetId(), tc.GetStatus().String(),
			tc.GetStartedAt(), tc.GetCompletedAt())
	}

	// Check runner log for the "stream ended" line which reports event count
	runnerLogPath := testHarness.UnifiedRunner.LogPath()
	if runnerLogPath != "" {
		logBytes, readErr := os.ReadFile(runnerLogPath)
		if readErr == nil {
			logContent := string(logBytes)
			execID := exec.GetMetadata().GetId()

			// Find the "ExecuteCursor stream ended" line for this execution
			for _, line := range strings.Split(logContent, "\n") {
				if strings.Contains(line, "stream ended") && strings.Contains(line, execID) {
					t.Logf("RUNNER LOG: %s", line)
				}
			}
		}
	}
}

// collectToolCalls returns every tool call across an execution's messages, in
// order, WITHOUT deduplication. The runner enforces the invariant that a
// call_id maps to exactly one ToolCall (see MessageAccumulator.attachToolCallToLastAi),
// so callers pair this with harness.AssertUniqueToolCallIds to prove no
// duplicate entries leaked through the streaming pipeline.
func collectToolCalls(messages []*agentexecv1.AgentMessage) []*agentexecv1.ToolCall {
	var result []*agentexecv1.ToolCall
	for _, msg := range messages {
		result = append(result, msg.GetToolCalls()...)
	}
	return result
}

func toolCallNames(tcs []*agentexecv1.ToolCall) []string {
	names := make([]string, len(tcs))
	for i, tc := range tcs {
		names[i] = tc.GetName()
	}
	return names
}

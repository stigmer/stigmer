//go:build integration

package offline

import (
	"context"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Offline Approval-Gate Diff Tests (#186, deferred phase T02) ---
//
// These prove the *pre-execution* half of first-class diff review end-to-end:
// when a file-modifying tool is gated for human approval, the runner captures the
// proposed before/after at the interrupt (the graph is paused, so the read is
// race-free), attaches it to the WAITING_APPROVAL ToolCall, and the server
// projection copies it onto the PendingApproval the approver sees. The
// post-execution capture (file_changes_offline_test.go) is the *other* half;
// these tests additionally prove the gate -> post-exec transition stays clean.
//
// Like the rest of the offline suite they run against the MockLLMProxyServer (no
// provider keys) and need no MCP server: write_file / edit_file are built into
// every native agent and gate automatically when auto_approve_all is false (the
// runner's approval-gate middleware classifies them as dangerous platform tools),
// so no ToolApprovalOverride is required. Determinism comes from scripting the
// exact LLM turns; mockLLM.Remaining()==0 guards against extra calls.

// TestOffline_ApprovalGate_NativeWriteThenEdit_FileChangeOnPendingApproval drives
// one native execution through two sequential approval gates — a write (CREATE)
// then an edit (MODIFY) of the same file — and asserts, at each gate, that the
// proposed diff is present on BOTH the WAITING_APPROVAL ToolCall (the projection's
// source) and the projected PendingApproval (what the approver renders). This is
// the pre-execution diff-review contract this phase exists to prove, and it
// exercises CREATE/WHOLE_FILE and MODIFY/HUNK_ONLY capture plus the Java
// projection end-to-end.
//
// Scope note (deliberate): this test does NOT assert the post-execution
// file_changes after approval. The offline harness uses the ephemeral MemorySaver
// checkpointer (see shared/checkpointer/factory.ts — "memory … for OSS / local
// mode"), recreated per activity invocation, so a gated multi-invocation flow
// replays from scratch and the final transcript retains only the last turn rather
// than the accumulated history that the production HTTP durable checkpointer
// preserves via seedStatusFromExecution. Post-execution WHOLE_FILE capture is
// already proven for the single-invocation path by
// TestOffline_FileChanges_NativeWriteAndEdit_CapturesWholeFile, and the
// gate->post-exec replace mechanics by the runner unit tests
// (shared/file-change.ts, approval-file-change.test.ts).
func TestOffline_ApprovalGate_NativeWriteThenEdit_FileChangeOnPendingApproval(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	filePath := uniqueWorkspacePath("gate-write-edit")
	const created = "alpha\nbeta\n"

	entries := []harness.RecordedLLMEntry{
		// Turn 1: create the file (gated).
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_ag_write_01", "write_file",
			map[string]any{"file_path": filePath, "content": created},
			300, 40,
		)),
		// Turn 2: edit the file beta -> gamma (gated).
		harness.BuildLLMEntry(1, harness.AnthropicToolUseResponse(
			"toolu_ag_edit_01", "edit_file",
			map[string]any{"file_path": filePath, "old_string": "beta", "new_string": "gamma"},
			320, 40,
		)),
		// Turn 3: finish.
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"Created and edited the file.", 360, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-approval-gate-"+t.Name(),
		"You are a test agent. Use the filesystem tools to write and edit files.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Write a file then edit it using the filesystem tools.",
		harness.WithAutoApproveAll(false),
	)
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// --- Gate 1: write_file -> CREATE / WHOLE_FILE ---
	gate1, err := waiter.WaitForPendingApproval(ctx, execID, "write_file", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should gate on write_file: %v", err)
	}
	harness.AssertAgentPhase(t, gate1, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

	// The projection the approver renders.
	createPa := harness.AssertPendingApprovalFileChange(t, gate1, "write_file", filePath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)
	require.NotNil(t, createPa, "write gate must project a file change onto the pending approval")
	assert.Nil(t, createPa.GetBefore(), "a CREATE has no before side")
	require.NotNil(t, createPa.GetAfter(), "a CREATE must carry the proposed content as after")
	assert.Equal(t, created, createPa.GetAfter().GetInline(), "pending approval after should be the proposed content, inline")
	assert.False(t, createPa.GetAfter().GetIsBinary(), "text content must not be flagged binary")

	// The projection's source: the same diff on the WAITING_APPROVAL ToolCall.
	createSrc := harness.AssertFileChange(t, gate1, filePath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)
	require.NotNil(t, createSrc, "write gate must attach a file change to the WAITING_APPROVAL ToolCall")
	assert.Equal(t, created, createSrc.GetAfter().GetInline(),
		"pending approval file change must match its ToolCall source (the projection copies, not invents)")

	approveGate(t, ctx, clients, execID, gate1, "write_file")

	// --- Gate 2: edit_file -> MODIFY / HUNK_ONLY ---
	gate2, err := waiter.WaitForPendingApproval(ctx, execID, "edit_file", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should gate on edit_file after the write is approved: %v", err)
	}
	harness.AssertAgentPhase(t, gate2, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

	editPa := harness.AssertPendingApprovalFileChange(t, gate2, "edit_file", filePath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY)
	require.NotNil(t, editPa, "edit gate must project a hunk-only file change onto the pending approval")
	// HUNK_ONLY carries the synthesized old->new patch, not whole-file bodies.
	assert.Nil(t, editPa.GetBefore(), "a HUNK_ONLY edit carries no whole-file before")
	assert.Nil(t, editPa.GetAfter(), "a HUNK_ONLY edit carries no whole-file after")
	diff := editPa.GetUnifiedDiff()
	assert.Containsf(t, diff, "-beta", "hunk should show the removed line; got:\n%s", diff)
	assert.Containsf(t, diff, "+gamma", "hunk should show the added line; got:\n%s", diff)
	assert.Equal(t, int32(1), editPa.GetLinesAdded(), "one line added (gamma)")
	assert.Equal(t, int32(1), editPa.GetLinesRemoved(), "one line removed (beta)")

	approveGate(t, ctx, clients, execID, gate2, "edit_file")

	// --- Terminal: both gates approved, execution finishes cleanly ---
	// We assert only what the offline harness can prove faithfully: the agent made
	// exactly the scripted calls and reached COMPLETED with no approval lingering.
	// Post-execution file_changes after a gated resume are intentionally NOT
	// asserted here — see the scope note on this function (MemorySaver checkpointer
	// limitation; post-exec capture is covered by the auto-approve TestOffline_File
	// Changes_NativeWriteAndEdit and the runner unit tests).
	result, err := waiter.WaitForTerminal(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should complete after both approvals")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	assert.Equal(t, 0, mockLLM.Remaining(),
		"all scripted LLM entries should be consumed (agent made exactly the scripted calls)")
	harness.AssertPendingApprovals(t, result, 0)
}

// TestOffline_ApprovalGate_LargeBody_OffloadedOnPendingApproval proves DD-002.4:
// a gated write whose proposed body exceeds the inline cap (128 KiB) surfaces on
// the PendingApproval as an offloaded ToolCallOutputRef, never an oversized inline
// body. Offload runs at persistStatus BEFORE the server recomputes the
// projection, so pending_approvals copies a small reference, not megabytes.
func TestOffline_ApprovalGate_LargeBody_OffloadedOnPendingApproval(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	filePath := uniqueWorkspacePath("gate-offload")

	line := "A line of deterministic text used to exceed the inline cap.\n"
	largeContent := strings.Repeat(line, 5000) // ~295 KB
	require.Greater(t, len(largeContent), 128*1024, "fixture must exceed the inline cap")

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_ag_write_big", "write_file",
			map[string]any{"file_path": filePath, "content": largeContent},
			300, 40,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Wrote the large file.", 340, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-approval-gate-"+t.Name(),
		"You are a test agent. Use the filesystem tools to write files.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Write a large file using the filesystem tools.",
		harness.WithAutoApproveAll(false),
	)
	execID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	gate, err := waiter.WaitForPendingApproval(ctx, execID, "write_file", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should gate on the large write_file: %v", err)
	}

	pa := harness.AssertPendingApprovalFileChange(t, gate, "write_file", filePath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)
	require.NotNil(t, pa, "large write gate must project a file change onto the pending approval")

	after := pa.GetAfter()
	require.NotNil(t, after, "a CREATE must carry the proposed content as after")
	assert.Empty(t, after.GetInline(), "an offloaded body must not also be inline on the pending approval")

	ref := after.GetRef()
	require.NotNil(t, ref, "an oversized after body must be offloaded to a ToolCallOutputRef on the pending approval")
	assert.Truef(t, strings.HasPrefix(ref.GetStorageKey(), "artifacts/"),
		"offload storage key %q should live under artifacts/", ref.GetStorageKey())
	assert.Containsf(t, ref.GetStorageKey(), execID,
		"offload storage key %q should be scoped to the execution id %s", ref.GetStorageKey(), execID)
	assert.Greaterf(t, ref.GetSizeBytes(), int64(128*1024),
		"offloaded ref should report the full body size, got %d", ref.GetSizeBytes())

	// Approve to drive the execution to a clean terminal state.
	approveGate(t, ctx, clients, execID, gate, "write_file")
	result, err := waiter.WaitForTerminal(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should complete after approval")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	assert.Equal(t, 0, mockLLM.Remaining(), "all scripted LLM entries should be consumed")
}

// approveGate submits an APPROVE for the named tool's pending approval in the
// given snapshot. It fails the test if the snapshot carries no such approval.
func approveGate(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	executionID string,
	snapshot *agentexecv1.AgentExecution,
	toolName string,
) {
	t.Helper()
	pa := harness.FindPendingApproval(snapshot, toolName)
	require.NotNilf(t, pa, "expected a pending approval for %q to approve", toolName)
	_, err := clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: executionID,
		ToolCallId:       pa.GetToolCallId(),
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoErrorf(t, err, "submit approval for %q (%s)", toolName, pa.GetToolCallId())
}

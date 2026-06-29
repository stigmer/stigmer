//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorHarness_HITL_WriteGate_Approve is the end-to-end proof that the
// Cursor harness human-in-the-loop gate works for a real, UNCONSTRAINED agent.
//
// It deliberately does NOT tell the agent which tool to use or to "stop after
// one call" — the previous version of this test over-constrained the agent and
// asserted a fabricated PascalCase tool name, which masked the real regression
// (the hook and the SDK stream use different tool taxonomies, so the approval
// never correlated to the streamed tool call). Here we give a natural task and
// assert the real end-user experience:
//  1. The agent edits a file (the SDK streams it as `edit`; the hook denies it
//     as `Write`).
//  2. The execution surfaces WAITING_FOR_APPROVAL with a pending approval whose
//     tool call is the REAL streamed tool marked WAITING_APPROVAL.
//  3. The user APPROVES.
//  4. The reinvocation grant (keyed by the exact resource) lets the re-attempt
//     through and the execution completes with the file written.
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_WriteGate_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-approve",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// auto_approve_all=false → the file mutation must pause at the approval gate.
	// Natural task: no tool prescription, no "stop after one call".
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called gated.txt containing exactly the text: hello-hitl.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"cursor harness should surface a pending approval for the gated file mutation")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	t.Logf("pending approval: tool=%s, id=%s, message=%q",
		approval.GetToolName(), approval.GetToolCallId(), approval.GetMessage())
	assert.True(t, isGatedMutatingTool(approval.GetToolName()),
		"expected a gated mutating tool (write/edit/shell/delete in either taxonomy), got %q",
		approval.GetToolName())

	// Load-bearing invariant: the backend projects pending_approvals from
	// tool-call status, so the gated tool call must itself carry WAITING_APPROVAL
	// (not COMPLETED). This is the exact regression that hid the approval gate —
	// and it must be the REAL streamed tool call, not a synthesized placeholder.
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// The point of this fix: the user must SEE the proposed change BEFORE
	// approving. The gate carries the authoritative content the hook captured —
	// a WHOLE_FILE CREATE diff plus a parseable args preview — not "No preview
	// available".
	assertApprovalShowsProposedChange(t, approval)
	assertApprovalHasWholeFileCreate(t, approval, "hello-hitl")

	// Approve and let the reinvocation grant carry the re-attempted edit through.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the file mutation is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The approved mutation must have actually executed on the resumed turn —
	// proving the exact-resource grant let the re-attempt (fresh tool-call id)
	// through.
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_ExactApply_ApprovedBytesLandVerbatim is the end-to-end
// proof of the "what you approve is what gets applied" guarantee for the Cursor
// deny-only harness.
//
// The harness cannot pause mid-tool: it denies, grants the resource, and
// reinvokes the model — which REGENERATES content, so a grant alone cannot
// promise the bytes that land match the bytes shown (observed in production: a
// gate previewing one change, an applied file carrying more). The fix makes the
// runner apply the EXACT approved whole-file content itself and issue NO resource
// grant. This test asserts both halves of that contract:
//
//  1. APPLIED == APPROVED — the SAME gated tool call is COMPLETED in place, and
//     its recorded `after` content is byte-identical to what the user approved
//     (the runner wrote exactly those bytes; the model did not get to regenerate
//     them on reinvocation).
//  2. NO BLANKET GRANT — a DISTINCT subsequent change to the SAME file RE-GATES,
//     because exact-apply deliberately issues no resource grant, so the user sees
//     and approves every change.
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_ExactApply_ApprovedBytesLandVerbatim(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-exact-apply",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1 — gate a whole-file create and capture exactly what the user sees.
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called exact-apply.txt containing exactly the text: alpha-exact",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals())

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())
	require.NotEmpty(t, approval.GetFileChanges(),
		"the whole-file create must show its proposed content at the gate")
	gateAfter := approval.GetFileChanges()[0].GetAfter().GetInline()
	require.NotEmpty(t, gateAfter,
		"a whole-file gate must carry inline `after` content (the bytes the user approves)")
	gateToolCallID := approval.GetToolCallId()

	// Approve.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the write is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Contract 1 — APPLIED == APPROVED. The runner exact-applied the write: the
	// SAME gated tool call is COMPLETED in place (not a fresh model re-attempt),
	// and its `after` content is byte-identical to what was approved.
	appliedCall := findToolCallByID(result, gateToolCallID)
	require.NotNilf(t, appliedCall,
		"the gated tool call %s must persist (exact-apply completes it in place)", gateToolCallID)
	assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, appliedCall.GetStatus(),
		"exact-apply must complete the gated tool call in place")
	require.NotEmpty(t, appliedCall.GetFileChanges(),
		"the completed tool call must retain the approved change as its record")
	assert.Equal(t, gateAfter, appliedCall.GetFileChanges()[0].GetAfter().GetInline(),
		"the applied bytes must equal the approved bytes verbatim — the model must not "+
			"have regenerated different content on reinvocation")

	// Contract 2 — NO BLANKET GRANT. A DISTINCT change to the SAME file must
	// re-gate, proving exact-apply left no resource grant that would silently
	// auto-apply a regenerated (and unreviewed) write.
	_, waiting2 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Now replace the contents of exact-apply.txt with exactly: beta-exact",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting2, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting2.GetStatus().GetPendingApprovals(),
		"a distinct change to the same file must RE-GATE — exact-apply must not leave a "+
			"blanket resource grant that bypasses review of the new content")
}

// findToolCallByID returns the first tool call with the given id across all
// messages, or nil. Used to assert exact-apply completed the gate's own tool
// call in place (same id), not a fresh model re-attempt.
func findToolCallByID(exec *agentexecv1.AgentExecution, id string) *agentexecv1.ToolCall {
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		if tc.GetId() == id {
			return tc
		}
	}
	return nil
}

// TestCursorHarness_HITL_WholeFileMultiChange_FullDiffShownAndApplied is the
// end-to-end proof of FULL-CHANGE FIDELITY: when a single turn requests several
// changes to one file, the approval card must show the COMPLETE intended change
// and approving must apply exactly that — never a partial that silently drops the
// rest.
//
// The reported regression: an agent asked to (a) rename "Planton Cloud" ->
// "Planton" AND (b) add a "## TODO" section expressed both as one whole-file
// write, but the gate captured only a partial streamed snapshot (the rename),
// exact-apply wrote that partial verbatim, and the TODO section vanished — the
// agent then looped re-attempting it. The fix sources the gate's whole-file diff
// from the authoritative hook-captured input, so shown == approved == applied ==
// the complete content.
//
// The hard, mechanism-agnostic assertion is that BOTH changes land on disk after
// approval and the execution COMPLETES (no loop). When the agent expresses both
// changes as one whole-file write, we additionally assert the single gate card
// already shows the complete content. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_WholeFileMultiChange_FullDiffShownAndApplied(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Pre-seed the file's "before" content so the requested edits rewrite an
	// EXISTING file — the shape that exposed the bug (a streamed snapshot diverging
	// from the complete intended content).
	wsDir := harness.UnifiedRunnerWorkspaceDir()
	require.NoError(t, os.MkdirAll(wsDir, 0o755))
	fileName := "multichange-notes.md"
	absPath := filepath.Join(wsDir, fileName)
	require.NoError(t, os.WriteFile(absPath,
		[]byte("# Project Notes\n- Built on Planton Cloud\n"), 0o644))
	t.Cleanup(func() { _ = os.Remove(absPath) })

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-multichange",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"In the file "+fileName+", change 'Planton Cloud' to 'Planton', and add a "+
			"'## TODO' section at the end with exactly two bullets: '- write tests' and "+
			"'- ship it'. Make BOTH changes.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the multi-change edit must pause at the approval gate")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	logGateGroundTruth(t, approval)

	// When the agent expressed both changes as ONE whole-file write, the gate must
	// already show the COMPLETE content — the precise shape the fix corrects. (If
	// the agent chose sequential hunk edits instead, the disk assertion below is
	// the mechanism-agnostic guarantee.)
	if len(approval.GetFileChanges()) == 1 &&
		approval.GetFileChanges()[0].GetCaptureLevel() ==
			agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE {
		after := approval.GetFileChanges()[0].GetAfter().GetInline()
		assert.Contains(t, after, "## TODO",
			"a whole-file gate must show the COMPLETE intended content (the new TODO "+
				"section), not a partial snapshot that drops it")
		assert.Contains(t, after, "Planton",
			"the whole-file gate must also show the rename")
	}

	// Approve through every gate (a sequential-hunk path re-gates the second change).
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		4*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after approving the change(s)")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The user contract, mechanism-agnostic: BOTH requested changes are on disk.
	// Before the fix the TODO section was silently dropped and the agent looped.
	data, err := os.ReadFile(absPath)
	require.NoError(t, err, "the edited file must exist after completion")
	content := string(data)
	assert.Contains(t, content, "## TODO",
		"the TODO section (the second change) must be applied — the silently-dropped "+
			"change this fix closes")
	assert.Contains(t, content, "Planton",
		"the rename must be applied")
	assert.NotContains(t, content, "Planton Cloud",
		"the rename must replace 'Planton Cloud' with no stale text left behind")
}

// TestCursorHarness_HITL_TwoDistinctFiles_SecondReGatesAndLands proves the
// one-gate-per-turn contract does not LOSE a genuinely distinct second change: a
// turn that writes two different files surfaces exactly one gate; the deferred
// sibling must re-gate on a later turn and still land. This is the "case B"
// guarantee that sequential gating is lossless (distinct from the same-file
// full-change fidelity above). Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_TwoDistinctFiles_SecondReGatesAndLands(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	wsDir := harness.UnifiedRunnerWorkspaceDir()
	require.NoError(t, os.MkdirAll(wsDir, 0o755))
	fileA := "caseb-alpha.txt"
	fileB := "caseb-beta.txt"
	absA := filepath.Join(wsDir, fileA)
	absB := filepath.Join(wsDir, fileB)
	_ = os.Remove(absA)
	_ = os.Remove(absB)
	t.Cleanup(func() { _ = os.Remove(absA); _ = os.Remove(absB) })

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-two-files",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create two files in the workspace: "+fileA+" containing exactly 'alpha', and "+
			fileB+" containing exactly 'beta'.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	// One gate per turn: exactly one pending approval is surfaced even though two
	// distinct writes were attempted; the sibling is deferred (hidden SKIPPED).
	require.Len(t, waiting.GetStatus().GetPendingApprovals(), 1,
		"one gate per turn: only the first file's write is surfaced; the second is deferred")

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		4*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after approving both sequential gates")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Both files landed: the deferred second change re-gated and was applied — the
	// one-gate-per-turn collapse defers, it never drops.
	dataA, errA := os.ReadFile(absA)
	require.NoErrorf(t, errA, "%s must exist after completion", fileA)
	assert.Contains(t, string(dataA), "alpha")
	dataB, errB := os.ReadFile(absB)
	require.NoErrorf(t, errB,
		"%s must exist after completion — the deferred second change must re-gate and land", fileB)
	assert.Contains(t, string(dataB), "beta")
}

// TestCursorHarness_HITL_EditGate_ShowsDiff_Approve proves the approval preview
// works for an in-place EDIT, not just a new-file write. It runs two turns on one
// session: turn 1 creates a file (gated → approved), turn 2 edits it. The edit is
// gated before its hunk ever streams, so this exercises the runner's deny-time
// synthesis of the diff from the hook-captured old/new strings — the user must
// SEE the proposed change before approving, never "No preview available".
//
// The hard assertion is that the gate carries a proposed change (file_changes +
// args_preview); when the agent chose an in-place edit (HUNK_ONLY) the unified
// diff is additionally validated. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_EditGate_ShowsDiff_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-edit-approve",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1 — create the file, approve the gated write so it lands on disk.
	createExec, createWaiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called editme.txt containing exactly the text: alpha",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, createWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, createWaiting.GetStatus().GetPendingApprovals())
	createResult, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		createExec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	require.NoError(t, err, "turn 1 (create) should complete after approval")
	harness.AssertAgentPhase(t, createResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Turn 2 — edit the now-existing file in place; the mutation must gate again.
	editExec, editWaiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"In editme.txt, change the word alpha to beta. Make a minimal in-place edit.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, editWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, editWaiting.GetStatus().GetPendingApprovals(),
		"the in-place edit must pause at the approval gate")

	approval := editWaiting.GetStatus().GetPendingApprovals()[0]
	assertToolCallWaitingApproval(t, editWaiting, approval.GetToolCallId())

	// The core guarantee: the user sees the proposed change before approving.
	assertApprovalShowsProposedChange(t, approval)
	// When the agent made an in-place edit, the gate shows a real hunk diff.
	if approval.GetFileChanges()[0].GetCaptureLevel() ==
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY {
		assertApprovalHasHunkDiff(t, approval)
		t.Logf("edit gate presented a HUNK diff: %q", approval.GetFileChanges()[0].GetUnifiedDiff())
	} else {
		t.Logf("agent rewrote the file (whole-file change) rather than an in-place edit; "+
			"proposed change still shown at the gate (capture_level=%s)",
			approval.GetFileChanges()[0].GetCaptureLevel())
	}

	// Approve and confirm the edit completes via the reinvocation grant.
	editResult, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		editExec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, editExec.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 2 (edit) should complete after approval")
	harness.AssertAgentPhase(t, editResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
}

// TestCursorHarness_HITL_EditGate_WholeFileRewrite_ShowsDiff is the regression
// proof for the reported bug: when the agent rewrites an EXISTING file's whole
// contents (the Cursor SDK streams it as `edit` but the captured tool_input is a
// whole-file `contents` shape, not `old_string`/`new_string`), the gate must
// still show a real before/after diff — never the raw "Content [N chars]" args
// box that the screenshot exhibited.
//
// Before the fix, the runner's gate builder bailed on a FILE_EDIT-classified
// tool whose input had no old/new strings, leaving file_changes empty so the SDK
// fell back to the args view. After the fix, the gate reads the existing file
// from the workspace and presents a WHOLE_FILE before/after MODIFY (or a HUNK if
// the agent chose a minimal edit). Either way the user SEES the change.
//
// It also logs ground truth (tool name, capture level, before/after presence)
// and asserts there is no settled duplicate card beside the gate. Requires
// CURSOR_API_KEY.
func TestCursorHarness_HITL_EditGate_WholeFileRewrite_ShowsDiff(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-rewrite-diff",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1 — create a multi-line file and approve it onto disk, so turn 2 edits
	// an EXISTING file (the precondition for a real before/after diff).
	createExec, createWaiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called rewrite-me.txt with exactly these three lines:\n"+
			"one\ntwo\nthree",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, createWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, createWaiting.GetStatus().GetPendingApprovals())
	createResult, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		createExec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	require.NoError(t, err, "turn 1 (create) should complete after approval")
	harness.AssertAgentPhase(t, createResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Turn 2 — rewrite the WHOLE file. Asking for a full replacement biases the
	// agent toward a whole-file write/apply (the `contents` shape) rather than a
	// minimal str-replace, which is exactly the path that previously produced an
	// empty gate.
	editExec, editWaiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Replace the ENTIRE contents of rewrite-me.txt with exactly these five "+
			"lines (rewrite the whole file, do not make a minimal edit):\n"+
			"alpha\nbeta\ngamma\ndelta\nepsilon",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, editWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, editWaiting.GetStatus().GetPendingApprovals(),
		"the whole-file rewrite must pause at the approval gate")

	approval := editWaiting.GetStatus().GetPendingApprovals()[0]
	assertToolCallWaitingApproval(t, editWaiting, approval.GetToolCallId())

	// Ground truth for the record, then the core regression lock: the gate shows
	// a proposed change (non-empty file_changes + valid args_preview) — NOT the
	// "Content [N chars]" args fallback that empty file_changes produces.
	logGateGroundTruth(t, approval)
	assertApprovalShowsProposedChange(t, approval)

	// No settled duplicate card may sit beside the gate for the same resource.
	assertNoSettledDuplicateForResource(t, editWaiting, approval)

	editResult, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		editExec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, editExec.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 2 (whole-file rewrite) should complete after approval")
	harness.AssertAgentPhase(t, editResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
}

// TestCursorHarness_HITL_AdversarialShellWorkaround_StillGated proves the agent
// cannot bypass the gate by "working around" a blocked file edit with the shell.
// The Cursor shell tool is `execute` (hook `Shell`) and is gated too, so an
// agent that is explicitly told to improvise must STILL pause for approval and
// must NOT complete any mutating tool. This is the adversarial scenario the old
// over-constrained test could never exercise. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_AdversarialShellWorkaround_StillGated(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-adversarial",
		"You are a resourceful coding assistant. If one approach is blocked, you "+
			"try alternative approaches to accomplish the task.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Explicitly invite the agent to bypass the gate via the shell. The gate must
	// hold: the execution pauses at WAITING_FOR_APPROVAL rather than completing.
	_, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called adversarial.txt containing the text: hi. "+
			"If your file-editing tool is blocked, work around it by using the "+
			"shell (e.g. echo) to create the file instead.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the gate must hold even when the agent is told to work around it via the shell")

	// One gate per turn (H-F): the single logical intent — write adversarial.txt —
	// must surface EXACTLY ONE approval card, even though the agent was explicitly
	// told to improvise a shell workaround. Before the deny-only single-pause fix,
	// the denied edit plus its `cat >`/`echo` shell workaround surfaced TWO cards
	// for one file (prod exec aex_01kw4p0cqgk0j8vvxbs5t8gv59). The workaround is now
	// the deferred sibling, blanked to a hidden SKIPPED row rather than a 2nd card.
	require.Len(t, waiting.GetStatus().GetPendingApprovals(), 1,
		"one logical intent must surface exactly one approval; a denied edit and its "+
			"shell workaround must collapse to a single gate, not two cards")

	// The surfaced approval must be a gated mutating tool (edit or shell), and
	// crucially NO mutating tool may have COMPLETED — the workaround was gated too.
	for _, pa := range waiting.GetStatus().GetPendingApprovals() {
		assert.True(t, isGatedMutatingTool(pa.GetToolName()),
			"pending approval %q should be a gated mutating tool", pa.GetToolName())
	}
	assertNoMutatingToolCompleted(t, waiting)
}

// TestCursorHarness_HITL_SequentialExecutions_BothGated is the regression lock
// for the process-cached-hook root cause: the Cursor SDK loads a workspace's
// .cursor/hooks.json (the hook script PATH) ONCE per runner process and caches
// it, ignoring later per-execution rewrites. When the hook script baked a
// PER-SESSION denial-ledger path, the FIRST gated execution in a runner process
// worked, but EVERY later one recorded its denials to the FIRST session's ledger
// while its own runner read an empty ledger — so it silently COMPLETED instead of
// pausing (no approval button, leaked "requires approval" narration). That is the
// exact "first one works, the rest don't" signature the user reported.
//
// This runs TWO sequential gated executions in the one shared suite runner, with
// the first left PAUSED (unresolved) while the second runs — the contamination
// condition. Both must reach WAITING_FOR_APPROVAL with a real pending approval.
// Pre-fix the second completed; post-fix (a stable hook script that resolves the
// current turn's ledger from an atomically-updated pointer) both gate. Requires
// CURSOR_API_KEY.
func TestCursorHarness_HITL_SequentialExecutions_BothGated(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-sequential",
		"You are a helpful coding assistant.",
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// First gated execution — leave it PAUSED (do NOT approve), so its turn is the
	// "first hook loaded into the runner process" that previously poisoned the
	// shared workspace's cached hook for everyone after it.
	session1 := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	_, waiting1 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session1.GetMetadata().GetId(),
		"Create a file called seq-one.txt containing exactly the text: one.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting1, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting1.GetStatus().GetPendingApprovals(),
		"first execution must gate (this one always worked, even before the fix)")

	// Second gated execution in the SAME runner process while the first is still
	// paused. This is the one that silently completed before the fix.
	session2 := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	_, waiting2 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session2.GetMetadata().GetId(),
		"Create a file called seq-two.txt containing exactly the text: two.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting2, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting2.GetStatus().GetPendingApprovals(),
		"second sequential execution must ALSO gate — a process-cached hook must "+
			"resolve THIS turn's denial ledger (via the active-turn pointer), not the "+
			"first session's; otherwise it records denials to the first ledger and "+
			"silently completes")
	approval2 := waiting2.GetStatus().GetPendingApprovals()[0]
	assert.True(t, isGatedMutatingTool(approval2.GetToolName()),
		"second execution's pending approval should be a gated mutating tool, got %q",
		approval2.GetToolName())
	assertToolCallWaitingApproval(t, waiting2, approval2.GetToolCallId())
	assertNoMutatingToolCompleted(t, waiting2)
}

// TestCursorHarness_HITL_ResumedTurn_StillGated reproduces the production
// regression where the approval gate silently vanished on every turn after the
// first (aex_01ktr5na07f5xtmn0dz3mfjtdp): Agent.resume() does not persist
// local.cwd, and when the runner omitted it the SDK re-rooted the resumed agent
// at the runner's own process.cwd() — loading the "project" setting source (the
// .cursor/hooks.json carrying the HITL preToolUse hook) from the wrong
// directory. Result: turn 1 was gated, but every subsequent message in the same
// session ran file edits and shell commands unguarded to COMPLETED.
//
// The test runs a benign first turn to completion (creates the agent), then
// requests a file mutation on the SECOND turn (resumes the agent) and asserts
// the gate still holds. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_ResumedTurn_StillGated(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-resumed-turn",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1: benign, read-only prompt — completes and persists the Cursor
	// agentId as harness_state_id so turn 2 takes the Agent.resume() path.
	first := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Reply with the single word: ready. Do not use any tools.",
		harness.WithAutoApproveAll(false),
	)
	firstResult, err := waiter.WaitForPhase(ctx, first.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, first.GetMetadata().GetId())
	}
	require.NoError(t, err, "benign first turn should complete")
	harness.AssertAgentPhase(t, firstResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Turn 2: the mutation. The resumed agent must still load the project HITL
	// hook, so the gate must hold exactly as it does on a fresh agent.
	_, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called resumed-gate.txt containing exactly the text: hello-resume.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the approval gate must hold on a resumed turn (second message in the session)")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assert.True(t, isGatedMutatingTool(approval.GetToolName()),
		"expected a gated mutating tool on the resumed turn, got %q", approval.GetToolName())
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())
	assertNoMutatingToolCompleted(t, waiting)
}

// TestCursorHarness_HITL_CleanPause_NoLoop_NoLeakedNarration is the end-to-end
// proof of the runner<->backend approval-finalize contract: when a gated tool is
// denied, the Cursor turn must pause CLEANLY on the tool call — a single, stable
// WAITING_FOR_APPROVAL with a real pending approval — and must NOT (a) oscillate
// back to RUNNING (the tight re-invocation loop), nor (b) leak the model's
// post-denial narration ("blocked by a hook", "approve ... when prompted",
// "I'll try the shell instead", "enable the hook in your Cursor settings") into
// the transcript rendered next to the approval card.
//
// It deliberately uses a resourceful agent and a workaround-inviting prompt —
// the exact conditions that, before the fix, made the model react to the denial
// (narrate defeat, attempt a second gated tool), the runner trim that shrunk the
// transcript, the backend append-only guard reject the shrink (stranding
// pending_approvals at 0), and the workflow tight-loop WAITING<->RUNNING.
//
// Determinism note: the model's exact prose is non-deterministic, so the
// authoritative regression locks live in the deterministic seam tests
// (update_status_guard_test.go, invoke_workflow_pause_test.go, and their Java
// mirrors). This test asserts the user-observable contract end to end.
//
// Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_CleanPause_NoLoop_NoLeakedNarration(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-clean-pause",
		"You are a resourceful coding assistant. If one approach is blocked, you "+
			"try alternative approaches to accomplish the task.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called clean-pause.txt containing the text: hi. "+
			"If your file-editing tool is blocked, work around it by using the "+
			"shell (e.g. echo) to create the file instead.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"a gated tool must surface a pending approval — not strand the execution at WAITING_FOR_APPROVAL with pending_approvals=0")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// Contract 1 — STABILITY + APPEND-ONLY: the pause must hold and the transcript
	// must never shrink. Before the fix the runner trimmed (removed) post-denial
	// narration, so the WAITING_FOR_APPROVAL finalize was SHORTER; the backend's
	// append-only guard rejected the shrink, pending_approvals collapsed to 0, and
	// the workflow re-invoked immediately, flipping RUNNING<->WAITING. Phase 5
	// makes the finalize append-only by construction (narration blanked in place,
	// count preserved), so this asserts both a single stable gate AND a
	// monotonic, non-shrinking message count across the window.
	assertApprovalPauseIsStable(t, ctx, clients, exec.GetMetadata().GetId(), 12*time.Second)

	// Contract 2 — CLEAN TRANSCRIPT: no leaked post-denial narration sits next to
	// the approval card. With the first-denial stop the model never emits the
	// inter-tool reaction; this guards the user-visible regression directly.
	assertNoLeakedDenialNarration(t, waiting)

	// Contract 3 — RESUME: approving carries the re-attempt through to completion
	// with the file actually written.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the gated mutation is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_AutoApproveAll_NoGate verifies the bypass: with
// auto_approve_all=true the same file mutation executes without ever pausing for
// approval. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_AutoApproveAll_NoGate(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-autoapprove",
		"You are a helpful coding assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called auto.txt containing exactly the text: hello-auto.",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete directly with auto_approve_all")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// No approval should ever have been surfaced.
	assert.Empty(t, result.GetStatus().GetPendingApprovals(),
		"auto_approve_all=true must not surface any approval gate")
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_McpToolGate_Approve is the missing end-to-end proof
// that the Cursor harness approval gate fires for an MCP tool — not just a
// built-in — and the empirical capture for the Phase 0 root-cause question.
//
// Until now the cross-harness MCP HITL test skipped the Cursor harness
// (harness.SkipCursorForHITLGate) "pending live preToolUse verification": no
// test had ever paused a Cursor execution on an MCP tool. This closes that gap.
// It forces a deterministic MCP tool (the mock server's "echo") to require
// approval via a per-agent override, drives a real cursor-agent to invoke it,
// and asserts the execution pauses at WAITING_FOR_APPROVAL with the gated MCP
// tool call marked WAITING_APPROVAL — then approves and runs to completion via
// the reinvocation grant.
//
// It also captures ground truth for the HITL UX bug (see
// inspectCursorMcpDenyGroundTruth): when CURSOR_EVENT_RECORD_DIR is set, it
// reports whether Cursor surfaced our hook's deny agent_message to the model or
// replaced it with its own generic "blocked by a hook" text — the asymmetry that
// makes the model narrate defeat. That part is logged, never asserted, because
// it characterizes upstream SDK behavior we do not control.
//
// Requires CURSOR_API_KEY. For the ground-truth capture, also export
// CURSOR_EVENT_RECORD_DIR (a writable dir) before the suite starts the runner.
func TestCursorHarness_HITL_McpToolGate_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Deterministic MCP tool forced to require approval. Using a per-agent
	// override isolates the MCP approval path from the built-in gate already
	// covered by TestCursorHarness_HITL_WriteGate_Approve.
	httpServer := harness.StartHTTPMcpServer(t)
	mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)
	harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
	harness.WaitForMcpServerTool(t, ctx, clients,
		mcpServer.GetMetadata().GetId(), "echo", 2*time.Minute)

	agent := harness.CreateAgent(t, ctx, clients, "test-cursor-hitl-mcp-gate",
		"You are a helpful assistant. When asked to use a tool, invoke it "+
			"directly via a tool call.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{{ToolName: "echo", RequiresApproval: true}},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// auto_approve_all=false → the gated MCP tool must pause at the approval gate.
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Call the MCP tool named \"echo\" with input \"hello\", wait for its "+
			"result, then reply with the single word DONE.",
		4*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"cursor harness must surface a pending approval for the gated MCP tool")

	approval := harness.FindPendingApproval(waiting, "echo")
	require.NotNil(t, approval,
		"expected a pending approval for the MCP tool \"echo\" — the beforeMCPExecution gate did not surface it")
	t.Logf("pending MCP approval: tool=%s id=%s message=%q",
		approval.GetToolName(), approval.GetToolCallId(), approval.GetMessage())

	// Load-bearing invariant (same as the built-in gate): the backend projects
	// pending_approvals from tool-call status, so the gated MCP tool call must
	// itself carry WAITING_APPROVAL.
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// Phase 0 ground truth: what did the model actually see on the MCP deny?
	inspectCursorMcpDenyGroundTruth(t, exec.GetMetadata().GetId(), "echo")

	// Approve; the reinvocation grant (name-keyed for MCP tools) must let the
	// re-attempted call through to completion.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		4*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the MCP tool is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
}

// approvalRequiredAgentMessageMarker is a stable substring of the hook's deny
// agent_message (hook-script.ts APPROVAL_REQUIRED_AGENT_MESSAGE). If the raw SDK
// stream contains it, Cursor forwarded our message to the model; if instead it
// only contains "blocked by a hook", Cursor replaced it with its own generic
// text — the root cause of the defeatist "fix your Cursor settings" narration.
const approvalRequiredAgentMessageMarker = "submitted to the user for approval automatically"

// inspectCursorMcpDenyGroundTruth reads the raw @cursor/sdk event stream (when
// CURSOR_EVENT_RECORD_DIR is set) and reports whether the denied MCP tool's
// model-visible result carried our hook agent_message or Cursor's generic
// "blocked by a hook" text. Pure diagnostics — it characterizes upstream SDK
// behavior we do not control, so it logs findings and never fails the test.
func inspectCursorMcpDenyGroundTruth(t *testing.T, execID, toolName string) {
	t.Helper()

	// Log the captured result shape (byte-heavy strings redacted) for the record.
	logCapturedCursorToolResult(t, execID, toolName)

	dir := os.Getenv("CURSOR_EVENT_RECORD_DIR")
	if dir == "" {
		t.Logf("PHASE 0 ground truth: CURSOR_EVENT_RECORD_DIR not set — export it to a " +
			"writable dir before the suite starts the runner to capture the model-visible deny text")
		return
	}

	path := filepath.Join(dir, execID+".cursor-events.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Logf("PHASE 0 ground truth: could not read recorded cursor events at %s: %v", path, err)
		return
	}

	raw := string(data)
	sawBlockedByHook := strings.Contains(raw, "blocked by a hook")
	sawOurMessage := strings.Contains(raw, approvalRequiredAgentMessageMarker)
	t.Logf("PHASE 0 GROUND TRUTH (MCP deny, tool=%q): model saw 'blocked by a hook'=%v, "+
		"saw our hook agent_message=%v", toolName, sawBlockedByHook, sawOurMessage)
	if sawBlockedByHook && !sawOurMessage {
		t.Logf("PHASE 0 CONFIRMED: Cursor replaced our deny agent_message with its generic " +
			"'blocked by a hook' text on the MCP path — the model has no signal that this is " +
			"an approval-in-progress (the root cause of the defeatist narration; drives the " +
			"runner-side clean-pause and the .cursor/rules escalation).")
	}
}

// assertApprovalPauseIsStable polls the live execution for the given window and
// fails if the approval pause is not stable — i.e. the phase leaves
// WAITING_FOR_APPROVAL, or pending_approvals empties, while the user has not
// submitted any decision. That instability is the exact signature of the tight
// re-invocation loop (backend rejected the runner's WAITING_FOR_APPROVAL
// transcript -> pending_approvals=0 -> workflow re-invokes immediately ->
// RUNNING) this fix eliminates. A stable gate stays WAITING_FOR_APPROVAL with a
// non-empty pending list until acted upon.
//
// It also asserts APPEND-ONLY at the live layer: the persisted transcript count
// must never decrease across the window. Phase 5 made the runner's
// WAITING_FOR_APPROVAL finalize append-only by construction — it BLANKS the
// model's provisional post-denial narration in place instead of removing the
// messages — so the backend's append-only guard accepts it with no phase
// carve-out. A shrinking transcript here would mean the runner regressed to
// removing messages (which the guard would then reject, re-stranding the gate).
func assertApprovalPauseIsStable(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	executionID string,
	window time.Duration,
) {
	t.Helper()
	deadline := time.Now().Add(window)
	polls := 0
	maxMessages := 0
	for time.Now().Before(deadline) {
		exec, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		require.NoError(t, err, "polling execution %s during stability window", executionID)

		phase := exec.GetStatus().GetPhase()
		require.Equalf(t, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, phase,
			"approval pause must remain stable: phase flipped to %s without any user decision "+
				"(the tight re-invocation loop). poll=%d", phase.String(), polls)
		require.NotEmptyf(t, exec.GetStatus().GetPendingApprovals(),
			"approval pause must remain stable: pending_approvals emptied without any user decision "+
				"(backend rejected the runner's WAITING_FOR_APPROVAL transcript). poll=%d", polls)

		msgCount := len(exec.GetStatus().GetMessages())
		require.GreaterOrEqualf(t, msgCount, maxMessages,
			"transcript must be append-only while paused: message count dropped from %d to %d "+
				"(the runner must blank post-denial narration in place, never remove it). poll=%d",
			maxMessages, msgCount, polls)
		if msgCount > maxMessages {
			maxMessages = msgCount
		}
		polls++

		select {
		case <-ctx.Done():
			t.Fatalf("context cancelled during stability window: %v", ctx.Err())
		case <-time.After(2 * time.Second):
		}
	}
	t.Logf("approval pause stable across %d poll(s) over %v (append-only, max %d messages)", polls, window, maxMessages)
}

// leakedDenialNarrationMarkers are characteristic substrings of the model's
// post-denial reaction that must never reach the persisted transcript shown next
// to the approval card. Cursor surfaces our hook deny to the model as a tool
// failure (often its own generic "blocked by a hook" text), and a well-behaved
// model reacts by narrating defeat or attempting a workaround. The first-denial
// stop (runner) prevents that reaction from ever being produced; this list lets
// the test assert the user-visible cleanliness directly. Lowercased compare.
var leakedDenialNarrationMarkers = []string{
	"blocked by a hook",
	"enable the hook",
	"cursor settings",
	"approve the write when prompted",
	"approve it when prompted",
	"when prompted",
	"i'll try the shell",
	"try the shell instead",
	"use the shell instead",
	"work around",
	"workaround",
}

// assertNoLeakedDenialNarration asserts no AI/thinking message content contains a
// leaked post-denial narration marker. This is the user-visible regression: a
// defeatist "I couldn't do this, approve it when prompted" verdict rendered right
// next to the card that is, in fact, asking for that approval.
func assertNoLeakedDenialNarration(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for i, msg := range exec.GetStatus().GetMessages() {
		if msg.GetType() != agentexecv1.MessageType_MESSAGE_AI &&
			msg.GetType() != agentexecv1.MessageType_MESSAGE_THINKING {
			continue
		}
		content := strings.ToLower(msg.GetContent())
		for _, marker := range leakedDenialNarrationMarkers {
			assert.NotContainsf(t, content, marker,
				"message[%d] leaks post-denial narration %q next to the approval card: %q",
				i, marker, msg.GetContent())
		}
	}
}

// assertToolCallWaitingApproval asserts the gated tool call carries
// TOOL_CALL_WAITING_APPROVAL + requires_approval. The backend's
// PendingApprovalComputer projects pending_approvals from exactly this status,
// so this is the invariant that makes the approval gate surface at all.
func assertToolCallWaitingApproval(t *testing.T, exec *agentexecv1.AgentExecution, toolCallID string) {
	t.Helper()
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() != toolCallID {
				continue
			}
			assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, tc.GetStatus(),
				"gated tool call %s must be WAITING_APPROVAL (drives the pending_approvals projection)", toolCallID)
			assert.True(t, tc.GetRequiresApproval(),
				"gated tool call %s must have requires_approval=true", toolCallID)
			return
		}
	}
	t.Errorf("tool call %s not found in waiting execution messages", toolCallID)
}

// assertApprovalShowsProposedChange is the core regression guard for the HITL
// approval-preview fix: a gated file mutation must let the user SEE the proposed
// change BEFORE approving. The backend projects both fields verbatim from the
// gated tool call, so a present, valid args_preview AND non-empty file_changes
// prove the runner captured the authoritative tool_input at gate time. Empty
// file_changes here is exactly the "No preview available for this change" bug.
func assertApprovalShowsProposedChange(t *testing.T, approval *agentexecv1.PendingApproval) {
	t.Helper()
	require.NotEmpty(t, approval.GetArgsPreview(),
		"gated approval must carry an args preview so the user sees the tool input before approving")
	var parsed map[string]any
	require.NoErrorf(t, json.Unmarshal([]byte(approval.GetArgsPreview()), &parsed),
		"args_preview must be valid JSON (the resumed turn re-parses it), got %q", approval.GetArgsPreview())
	require.NotEmpty(t, approval.GetFileChanges(),
		"gated file approval must carry file_changes (the proposed diff) BEFORE approval — "+
			"empty file_changes is the 'No preview available' regression this fix closes")
}

// assertApprovalHasWholeFileCreate asserts the first file change presented at the
// gate is a whole-file CREATE whose proposed content contains wantContentSubstr.
func assertApprovalHasWholeFileCreate(t *testing.T, approval *agentexecv1.PendingApproval, wantContentSubstr string) {
	t.Helper()
	fc := approval.GetFileChanges()[0]
	assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE, fc.GetChangeType(),
		"a new-file write gate should present a CREATE change")
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE, fc.GetCaptureLevel(),
		"a write gate should present the whole proposed file")
	assert.Contains(t, fc.GetAfter().GetInline(), wantContentSubstr,
		"the proposed content shown at the gate should contain the requested text")
}

// logGateGroundTruth records the empirical shape of a gated approval — the tool
// name, args preview, and each file change's capture level / change type /
// before-after presence — so a live run characterizes exactly what Cursor
// emitted (Phase 1). Pure diagnostics: it never asserts.
func logGateGroundTruth(t *testing.T, approval *agentexecv1.PendingApproval) {
	t.Helper()
	t.Logf("GATE GROUND TRUTH: tool=%q mcp=%q args_preview=%q file_changes=%d",
		approval.GetToolName(), approval.GetMcpServerSlug(),
		approval.GetArgsPreview(), len(approval.GetFileChanges()))
	for i, fc := range approval.GetFileChanges() {
		t.Logf("  file_change[%d]: path=%q change_type=%s capture_level=%s "+
			"has_before=%t has_after=%t unified_diff_len=%d",
			i, fc.GetPath(), fc.GetChangeType(), fc.GetCaptureLevel(),
			fc.GetBefore() != nil, fc.GetAfter() != nil, len(fc.GetUnifiedDiff()))
	}
}

// assertNoSettledDuplicateForResource is the duplicate-card regression lock. The
// gate's tool call is WAITING_APPROVAL; a same-resource denial twin that the
// runner did NOT fold would appear as a SEPARATE settled tool call (FAILED, or a
// stray COMPLETED) carrying the same file path — the second "No preview
// available" card in the report. After the fold, the twin is collapsed in place
// (SKIPPED + blanked), so no settled, content-bearing duplicate for the gated
// path remains.
//
// Best-effort by design (per the plan): the live duplicate depends on Cursor
// emitting two call-ids and is non-deterministic, so this only fires when a twin
// is actually present. The authoritative lock lives in the deterministic runner
// unit + projector tests.
func assertNoSettledDuplicateForResource(
	t *testing.T,
	exec *agentexecv1.AgentExecution,
	approval *agentexecv1.PendingApproval,
) {
	t.Helper()
	gatePath := ""
	if len(approval.GetFileChanges()) > 0 {
		gatePath = approval.GetFileChanges()[0].GetPath()
	}
	if gatePath == "" {
		return // no resolvable resource path to correlate against
	}
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		if tc.GetId() == approval.GetToolCallId() {
			continue // the gate itself
		}
		if !isGatedMutatingTool(tc.GetName()) {
			continue
		}
		status := tc.GetStatus()
		isSettledVisible := status == agentexecv1.ToolCallStatus_TOOL_CALL_FAILED ||
			status == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED
		if !isSettledVisible {
			continue
		}
		for _, fc := range tc.GetFileChanges() {
			assert.NotEqualf(t, gatePath, fc.GetPath(),
				"a settled duplicate tool call %s (%s) for the gated resource %q "+
					"renders a second card beside the approval gate — it must be "+
					"collapsed in place", tc.GetId(), status, gatePath)
		}
	}
}

// assertApprovalHasHunkDiff asserts the first file change presented at the gate
// is a HUNK_ONLY modify with a non-empty unified diff — the edit preview a user
// reviews before approving an in-place change.
func assertApprovalHasHunkDiff(t *testing.T, approval *agentexecv1.PendingApproval) {
	t.Helper()
	fc := approval.GetFileChanges()[0]
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY, fc.GetCaptureLevel(),
		"an edit gate should present a hunk diff")
	assert.NotEmpty(t, fc.GetUnifiedDiff(),
		"an edit gate's hunk must carry a non-empty unified diff so the user sees what changes")
}

// isGatedMutatingTool reports whether a tool name is a gated mutating tool in
// EITHER taxonomy the platform sees: the SDK stream (lowercase `edit`/`shell`/
// `delete`/`write`/`execute`) or the preToolUse hook (PascalCase `Write`/
// `StrReplace`/`EditNotebook`/`Shell`/`Delete`). Lowercasing collapses both.
// Kept in sync with approvalCategory() in approval-policy.ts.
func isGatedMutatingTool(name string) bool {
	switch strings.ToLower(name) {
	case "write", "edit", "strreplace", "editnotebook",
		"shell", "execute", "delete":
		return true
	default:
		return false
	}
}

// assertCompletedWrite asserts the persisted messages contain a write-like tool
// call that completed (not stuck WAITING_APPROVAL/RUNNING).
func assertCompletedWrite(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		name := strings.ToLower(tc.GetName())
		isWrite := strings.Contains(name, "write") || strings.Contains(name, "edit") ||
			name == "strreplace"
		if isWrite && tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED {
			t.Logf("approved write executed: tool=%s, status=%s", tc.GetName(), tc.GetStatus())
			return
		}
	}
	t.Errorf("expected a COMPLETED write tool call in persisted messages; none found")
}

// assertNoMutatingToolCompleted asserts that, while gated, NO mutating tool
// reached COMPLETED — proving the agent could not bypass the gate.
func assertNoMutatingToolCompleted(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		if isGatedMutatingTool(tc.GetName()) &&
			tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED {
			t.Errorf("mutating tool %q completed without approval — the gate was bypassed", tc.GetName())
		}
	}
}

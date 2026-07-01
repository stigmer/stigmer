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

// TestCursorHarness_HITL_HunkSiblingReGates_BothLand is the end-to-end proof of
// the content-exact identity fix (the reported bug): when a turn makes TWO
// DISTINCT in-place edits to ONE file, approving the FIRST must NOT silently let
// the SECOND through. Before the fix the second hunk rode the first edit's coarse
// (category, path) grant and executed UNGATED — the user approved the rename and
// the "## TODO" addition landed without ever being shown. After the fix the
// grant binds the approved content, so the distinct sibling RE-GATES; the user
// approves it too, and BOTH changes land with the execution COMPLETED (no loop).
//
// The deterministic proof that the sibling re-gates lives in the runner unit,
// real-bash-hook ("sibling isolation"), and cross-substrate contract (invariant
// 12) suites; this asserts the user-observable end state through a live agent.
// Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_HunkSiblingReGates_BothLand(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Pre-seed an EXISTING file so both edits are in-place hunks against real
	// "before" content — the exact shape of the reported regression.
	wsDir := harness.UnifiedRunnerWorkspaceDir()
	require.NoError(t, os.MkdirAll(wsDir, 0o755))
	fileName := "sibling-notes.md"
	absPath := filepath.Join(wsDir, fileName)
	require.NoError(t, os.WriteFile(absPath,
		[]byte("# Project Notes\n- Built on Planton Cloud\n"), 0o644))
	t.Cleanup(func() { _ = os.Remove(absPath) })

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-sibling-regate",
		"You are a helpful coding assistant.",
	)
	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"In "+fileName+", make TWO separate minimal in-place edits (do NOT rewrite "+
			"the whole file): (1) change 'Planton Cloud' to 'Planton', and (2) append "+
			"a new line at the end exactly: '## TODO'. Make BOTH edits.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the first in-place edit must pause at the approval gate")
	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())
	logGateGroundTruth(t, approval)

	// Approve through every gate. The content-exact grant means a DISTINCT second
	// edit to the same file re-gates rather than slipping through, so the resolver
	// satisfies each gate in turn — and the run must TERMINATE (no loop).
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		5*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after approving the sequential gates (no loop)")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Both changes landed: the sibling re-gated and was applied, never dropped and
	// never auto-applied ungated.
	data, err := os.ReadFile(absPath)
	require.NoError(t, err, "the edited file must exist after completion")
	content := string(data)
	assert.Contains(t, content, "## TODO",
		"the second edit (## TODO) must be applied")
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

// =============================================================================
// Capture mode (git workspaces)
// =============================================================================
//
// The tests above exercise the DENY-GATE fallback — the path for a non-git
// workspace, where the harness denies each file edit, surfaces one card, and
// re-invokes the model. The tests below exercise CAPTURE MODE, the primary path
// for a git workspace: the agent edits files freely during the turn, then at the
// turn boundary git captures the net change set per file and LEAVES the working
// tree in its applied ("after") state (Cursor parity — the user reviews the real
// on-disk change), surfacing one Accept/Reject card per changed file (carrying
// the authoritative git-derived WHOLE_FILE diff). On resume the tree is
// reconciled to the per-file decisions from the pinned refs: approved files are
// kept (uncommitted), rejected/undecided files snap back to baseline. Nothing is
// committed and the next turn is blocked until approval. A pure file-review turn
// short-circuits to COMPLETED on approval without re-invoking the agent
// (Cursor-like); a reject is a DISCARD that also COMPLETES (never FAILED). See
// the runner's shadow-capture.ts / capture-flow.ts and the deterministic unit
// suites for the authoritative locks; these prove the user-observable end state
// through a live agent.
//
// Capture mode is selected when the session's primary workspace is a real git
// work tree (execute-cursor/index.ts: captureMode = isGitWorkTree(...)). Each
// test attaches a hermetic git repo (harness.NewGitWorkspace) via a
// LocalPathSource workspace entry — the runner is co-located on this host, so it
// operates inside the repo and triggers the identical capture path a clone would,
// with no network/auth/flake. All of these require CURSOR_API_KEY.

// TestCursorHarness_Capture_TwoChangesOneFile_SingleCard_Approve is the headline
// capture-mode contract: several changes to ONE file in a single turn surface as
// exactly ONE Accept/Reject card carrying the file's complete net change — never
// the fragmentation the deny-gate produced (one card per edit, re-invocation
// loops, silently dropped changes). Approving applies the whole change in place
// and the turn COMPLETES without re-running the agent.
//
// In capture mode "one card per changed file" is structural (the card is the git
// diff baseline..after), so this is a guarantee, not an LLM-dependent hope.
// Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_TwoChangesOneFile_SingleCard_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedWorkspaceFile(t, gitDir, "notes.md",
		"# Project Notes\n- Built on Planton Cloud\n")

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-single-card",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"In notes.md, change 'Planton Cloud' to 'Planton', AND add a '## TODO' section "+
			"at the end with exactly two bullets: '- write tests' and '- ship it'. Make BOTH changes.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

	// Exactly one card, for notes.md, carrying the COMPLETE net change.
	require.Len(t, waiting.GetStatus().GetPendingApprovals(), 1,
		"capture mode must surface exactly ONE card for the single changed file — not "+
			"one per edit (the deny-gate fragmentation this path eliminates)")
	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assert.True(t, isGatedMutatingTool(approval.GetToolName()),
		"the capture card should be a gated mutating tool (edit), got %q", approval.GetToolName())
	fc := assertCaptureCardWholeFile(t, approval, "notes.md")
	after := fc.GetAfter().GetInline()
	assert.Contains(t, after, "## TODO",
		"the single card must show the COMPLETE intended content (the new TODO section)")
	assert.Contains(t, after, "Planton", "the card must also show the rename")
	assert.NotContains(t, after, "Planton Cloud",
		"the card's proposed content must reflect the rename with no stale text")

	// Approve — a pure file-review turn short-circuits to COMPLETED with no agent
	// re-invocation; the card is COMPLETED in place (id-stable), proving the
	// approved change was applied, not regenerated by a re-run.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "a pure file-review approval should complete (short-circuit, no loop)")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	card := findCaptureToolCall(result, "notes.md")
	require.NotNil(t, card, "the capture:notes.md card must persist after approval")
	assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, card.GetStatus(),
		"the approved capture card must be COMPLETED in place (applied, not re-attempted)")

	// Both changes landed on disk as uncommitted working-tree changes.
	content := harness.ReadWorkspaceFile(t, gitDir, "notes.md")
	assert.Contains(t, content, "## TODO", "the TODO section must be applied")
	assert.Contains(t, content, "Planton", "the rename must be applied")
	assert.NotContains(t, content, "Planton Cloud", "no stale pre-rename text may remain")
}

// TestCursorHarness_Capture_Reject_TreeByteIdentical proves the Cursor-IDE reject
// semantics: rejecting a captured change DISCARDS it and the execution COMPLETES
// (never FAILED), and the working tree snaps back BYTE-IDENTICAL to its pre-turn
// state. A SYSTEM message records what was discarded so the user sees it.
// Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_Reject_TreeByteIdentical(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	const seeded = "# Project Notes\n- Built on Planton Cloud\n"
	harness.SeedWorkspaceFile(t, gitDir, "notes.md", seeded)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-reject",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"In notes.md, change 'Planton Cloud' to 'Planton' and add a '## TODO' section at the end.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"the edit must surface a capture card for review (nothing is committed until approval)")

	// Reject — capture-mode reject is a DISCARD that COMPLETES (not FAILED).
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "capture-mode reject must COMPLETE with discard, not FAIL")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The working tree is byte-identical to the pre-turn state.
	assert.Equal(t, seeded, harness.ReadWorkspaceFile(t, gitDir, "notes.md"),
		"a rejected capture must snap the file back byte-for-byte to its pre-turn content")

	// The card is SKIPPED in place and a discard SYSTEM message is present.
	card := findCaptureToolCall(result, "notes.md")
	require.NotNil(t, card, "the capture:notes.md card must persist after reject")
	assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_SKIPPED, card.GetStatus(),
		"a rejected capture card must be SKIPPED in place")
	assert.True(t, hasDiscardSystemMessage(result),
		"a discard must record a SYSTEM message naming the discarded file(s)")
}

// TestCursorHarness_Capture_PartialDecision_OnlyApprovedLands proves per-file
// granularity: when a turn changes two files, the user can approve one and reject
// the other, and ONLY the approved file lands while the rejected one stays at
// baseline. It exercises the per-card resolver's approve-before-reject ordering
// (a reject resumes the turn immediately). Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_PartialDecision_OnlyApprovedLands(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	const alphaSeed = "alpha-before\n"
	const betaSeed = "beta-before\n"
	harness.SeedWorkspaceFile(t, gitDir, "alpha.txt", alphaSeed)
	harness.SeedWorkspaceFile(t, gitDir, "beta.txt", betaSeed)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-partial",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Replace the entire contents of alpha.txt with exactly 'alpha-after', and replace "+
			"the entire contents of beta.txt with exactly 'beta-after'. Change BOTH files.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	// Capture surfaces the whole change set at once (not one-gate-per-turn), so
	// both files are reviewable together.
	require.Len(t, waiting.GetStatus().GetPendingApprovals(), 2,
		"capture mode surfaces one card per changed file in a single review round")
	require.NotNil(t, findCaptureApprovalByPath(waiting, "alpha.txt"), "alpha.txt must have a card")
	require.NotNil(t, findCaptureApprovalByPath(waiting, "beta.txt"), "beta.txt must have a card")

	// Approve alpha.txt, reject beta.txt (approve submitted first by the resolver).
	result, err := waiter.ResolveApprovalsByPathUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		func(path string) agentexecv1.ApprovalAction {
			if path == "alpha.txt" {
				return agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE
			}
			return agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT
		},
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "a partial decision should complete (approved applied, rejected discarded)")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Only the approved file is kept; the rejected file is snapped back to baseline.
	assert.Equal(t, "alpha-after", strings.TrimSpace(harness.ReadWorkspaceFile(t, gitDir, "alpha.txt")),
		"the approved file must carry its new content")
	assert.Equal(t, betaSeed, harness.ReadWorkspaceFile(t, gitDir, "beta.txt"),
		"the rejected file must be byte-identical to its pre-turn content (the reject snapped it back)")

	if alphaCard := findCaptureToolCall(result, "alpha.txt"); assert.NotNil(t, alphaCard) {
		assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, alphaCard.GetStatus(),
			"approved card must be COMPLETED")
	}
	if betaCard := findCaptureToolCall(result, "beta.txt"); assert.NotNil(t, betaCard) {
		assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_SKIPPED, betaCard.GetStatus(),
			"rejected card must be SKIPPED")
	}
}

// TestCursorHarness_Capture_Accumulation_AcrossTurns proves the no-commit
// accumulation model: approved edits land as UNCOMMITTED working-tree changes and
// survive into the next turn's baseline, so a second turn builds on the first —
// and HEAD never moves (capture never commits). Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_Accumulation_AcrossTurns(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedWorkspaceFile(t, gitDir, "log.md", "# Log\n")
	headBefore := harness.WorkspaceHeadSHA(t, gitDir)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-accumulation",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1 — append TURN1, approve so it lands (uncommitted).
	exec1, waiting1 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Append a new line to log.md containing exactly: TURN1",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting1, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting1.GetStatus().GetPendingApprovals())
	result1, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec1.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	require.NoError(t, err, "turn 1 should complete after approval")
	harness.AssertAgentPhase(t, result1, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	require.Contains(t, harness.ReadWorkspaceFile(t, gitDir, "log.md"), "TURN1",
		"turn 1's approved change must land on disk")

	// Turn 2 — append TURN2; the baseline now includes turn 1's uncommitted change.
	exec2, waiting2 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Append another new line to log.md containing exactly: TURN2. Keep the existing content.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting2, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting2.GetStatus().GetPendingApprovals())
	result2, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec2.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec2.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 2 should complete after approval")
	harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Both turns' changes coexist, and HEAD never moved (no commits).
	final := harness.ReadWorkspaceFile(t, gitDir, "log.md")
	assert.Contains(t, final, "TURN1",
		"turn 1's change must survive into turn 2 (accumulation across turns)")
	assert.Contains(t, final, "TURN2", "turn 2's change must also be applied")
	assert.Equal(t, headBefore, harness.WorkspaceHeadSHA(t, gitDir),
		"capture mode must never commit — HEAD must be unchanged across both turns")
}

// TestCursorHarness_Capture_Rename_DeletePlusCreate_TwoCards proves a rename is
// captured as a delete of the old path + a create of the new path (renames are
// intentionally NOT detected, so each side is reviewable independently). The hard
// guarantee is the end state (old gone, new present); the two-card shape is
// asserted when the agent performed a clean rename. Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_Rename_DeletePlusCreate_TwoCards(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	const seeded = "shared content\n"
	harness.SeedWorkspaceFile(t, gitDir, "old.txt", seeded)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-rename",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Rename the file old.txt to new.txt, preserving its exact contents. The file "+
			"old.txt must no longer exist afterward.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(), "the rename must surface capture cards")

	// Two-card shape — asserted only when the agent performed a clean rename
	// (delete old + create new). An agent may instead copy without deleting; the
	// disk end-state below is the mechanism-agnostic guarantee.
	oldCard := findCaptureApprovalByPath(waiting, "old.txt")
	newCard := findCaptureApprovalByPath(waiting, "new.txt")
	if oldCard != nil && newCard != nil {
		assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_DELETE,
			oldCard.GetFileChanges()[0].GetChangeType(),
			"the old path should be captured as a DELETE")
		assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
			newCard.GetFileChanges()[0].GetChangeType(),
			"the new path should be captured as a CREATE")
	} else {
		t.Logf("rename not expressed as a clean delete+create (old=%v new=%v); "+
			"asserting end state only", oldCard != nil, newCard != nil)
	}

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "the rename should complete after approving the cards")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// End state: old gone, new present with the original content.
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, "old.txt"),
		"after a rename the old path must no longer exist")
	require.True(t, harness.WorkspaceFileExists(t, gitDir, "new.txt"),
		"after a rename the new path must exist")
	assert.Equal(t, seeded, harness.ReadWorkspaceFile(t, gitDir, "new.txt"),
		"the renamed file must preserve its original content")
}

// TestCursorHarness_Capture_RejectThenFollowUp_AgentResyncs is the standing
// CORROBORATING evidence for the next-turn re-sync residual, now CLOSED as a
// deliberate non-decision (no cross-turn re-sync note — see stigmer-cloud
// design-decisions/capture-reject-next-turn-resync-not-built.md). After a turn's
// edits are REJECTED (discarded, working tree at baseline), the Cursor SDK's
// native context still believes those edits stuck; on the next turn the agent
// may re-read the file (self-correcting) or build on the phantom content.
//
// This is corroborating evidence, NOT the safety guarantee: it requires
// CURSOR_API_KEY and so skips on every ordinary PR. The per-PR guarantee lives
// in the deterministic capture unit tests (capture-flow.test.ts /
// shadow-capture.test.ts), which prove every change becomes a reviewable card
// and a reject reverts byte-for-byte — so any edit built on phantom state is
// itself re-gated before it can land. This test therefore asserts only the
// robust contract (the follow-up turn completes and applies its own change) and
// LOGS the phantom-vs-fresh signal; it deliberately does not assert on it (LLM
// non-determinism). Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_RejectThenFollowUp_AgentResyncs(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	const seeded = "alpha\n"
	harness.SeedWorkspaceFile(t, gitDir, "notes.md", seeded)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-reject-followup",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1 — rewrite to 'beta', then REJECT (discard). Disk returns to 'alpha'.
	exec1, waiting1 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Replace the entire contents of notes.md with exactly: beta",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting1, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting1.GetStatus().GetPendingApprovals())
	result1, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec1.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	require.NoError(t, err, "turn 1 reject should complete with discard")
	harness.AssertAgentPhase(t, result1, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	require.Equal(t, seeded, harness.ReadWorkspaceFile(t, gitDir, "notes.md"),
		"after reject the file must be back to its pre-turn content")

	// Turn 2 — append 'gamma'. The agent's SDK context believes turn 1's 'beta'
	// stuck; the file on disk is actually 'alpha'.
	exec2, waiting2 := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Append a new line to notes.md containing exactly: gamma. Keep the existing content.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting2, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting2.GetStatus().GetPendingApprovals())
	result2, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec2.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec2.GetMetadata().GetId())
	}
	require.NoError(t, err, "turn 2 should complete after approval")
	harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Robust contract: the follow-up turn applied its own requested change.
	final := harness.ReadWorkspaceFile(t, gitDir, "notes.md")
	assert.Contains(t, final, "gamma", "the follow-up turn's own change must land")

	// EVIDENCE (logged, not asserted): did the agent build on the discarded
	// 'beta' (phantom state) or on 'alpha' (it self-corrected by reading the
	// file)? Follow-up 3 is CLOSED regardless — either way the agent's edit is
	// re-gated as a capture card before it can land. This signal is monitored
	// only as the revisit-trigger: repeated phantom-state builds would reopen
	// the decision (see capture-reject-next-turn-resync-not-built.md).
	builtOnPhantom := strings.Contains(final, "beta")
	preservedReal := strings.Contains(final, "alpha")
	t.Logf("FOLLOW-UP-3 EVIDENCE (reject-then-followup): final notes.md=%q; "+
		"built_on_discarded_beta=%v, preserved_real_alpha=%v", final, builtOnPhantom, preservedReal)
	if builtOnPhantom {
		t.Logf("FOLLOW-UP-3 SIGNAL: the agent built on the DISCARDED content — still safely " +
			"re-gated this turn, but if this recurs it is the revisit-trigger for a re-sync note.")
	} else if preservedReal {
		t.Logf("FOLLOW-UP-3 SIGNAL: the agent re-read the real file and self-corrected — the " +
			"closed decision (no cross-execution plumbing) holds.")
	}
}

// TestCursorHarness_Capture_MixedEditAndShell_FileCardPlusShellGate proves the
// two gating paths coexist in one turn: a file edit flows into a capture card,
// while an irreversible shell stays on the deny-gate (it cannot be snapshot-
// reverted). Approving everything runs the turn to completion. The exact card
// composition is non-deterministic (the model chooses tool order and whether the
// first-denial stop fires before the edit), so this asserts the robust contract —
// it pauses for approval, approving all completes — and LOGS the composition.
// Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_MixedEditAndShell_FileCardPlusShellGate(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedWorkspaceFile(t, gitDir, "notes.md", "# Notes\n")

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-mixed",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Do two things: (1) append a line 'edited' to notes.md, and (2) run the shell "+
			"command `echo hello` and report its output.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"a turn mixing an edit and a shell must pause for approval")

	// Ground truth: log the card composition (capture file card(s) vs shell gate).
	captureCards, shellGates := 0, 0
	for _, pa := range waiting.GetStatus().GetPendingApprovals() {
		if len(pa.GetFileChanges()) > 0 {
			captureCards++
		}
		if strings.EqualFold(pa.GetToolName(), "shell") || strings.EqualFold(pa.GetToolName(), "execute") {
			shellGates++
		}
	}
	t.Logf("MIXED-TURN composition: %d capture file card(s), %d shell gate(s), %d total pending",
		captureCards, shellGates, len(waiting.GetStatus().GetPendingApprovals()))

	// Approving everything (file cards + shell) runs the turn to completion; an
	// approved shell re-invokes the agent (the non-short-circuit branch).
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		4*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "approving all gates (file + shell) should complete the turn")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
}

// TestCursorHarness_Capture_GitignoredWrite_Approve is the CAS-parity headline
// (DD-18): a NON-secret gitignored write — invisible to the git snapshot — is no
// longer denied at the hook. The hook stages its pre-turn bytes into the
// cas-observations sidecar and lets it flow; the turn boundary captures it as a
// GIT_IGNORED_CAPTURED card; approving lands it byte-exact on disk. This is the
// live end-to-end proof of the deterministic hook + capture-flow unit coverage.
// Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_GitignoredWrite_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	// A NON-secret ignored dir: git cannot capture it, so the CAS substrate must.
	harness.SeedGitignorePattern(t, gitDir, "generated/")

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-gitignored-approve",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file at generated/output.txt containing exactly the text: hello-cas",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.True(t, hasApprovalForPath(waiting, "generated/output.txt"),
		"a non-secret gitignored write must surface a capture card for review (CAS parity), "+
			"not be silently denied")

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "approving a captured gitignored file should complete the turn")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The approved gitignored file landed byte-exact on disk.
	require.True(t, harness.WorkspaceFileExists(t, gitDir, "generated/output.txt"),
		"the approved gitignored file must be applied on disk")
	assert.Equal(t, "hello-cas", strings.TrimSpace(harness.ReadWorkspaceFile(t, gitDir, "generated/output.txt")),
		"the approved gitignored file must carry the exact captured content")
}

// TestCursorHarness_Capture_GitignoredWrite_Reject proves reject semantics for a
// captured gitignored ADD: discarding it COMPLETES (never FAILED) and removes the
// file, snapping the working tree back to its pre-turn state. Requires CURSOR_API_KEY.
func TestCursorHarness_Capture_GitignoredWrite_Reject(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedGitignorePattern(t, gitDir, "generated/")

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-capture-gitignored-reject",
		"You are a helpful coding assistant.",
	)
	session := createCaptureSession(t, ctx, clients, agent.GetStatus().GetDefaultInstanceId(), gitDir)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file at generated/output.txt containing exactly the text: hello-cas",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.True(t, hasApprovalForPath(waiting, "generated/output.txt"),
		"the gitignored write must surface a capture card before review")

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "rejecting a captured gitignored file must COMPLETE with discard, not FAIL")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// A rejected ADD leaves no file behind — the tree is back to pre-turn state.
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, "generated/output.txt"),
		"a rejected gitignored ADD must be removed (working tree snapped back)")
}

// =============================================================================
// Capture-mode test helpers
// =============================================================================

// hasApprovalForPath reports whether any pending approval carries a file change
// for the given workspace-relative path (used to assert a capture card surfaced
// for a specific file, tolerant of card ordering and the tool taxonomy).
func hasApprovalForPath(exec *agentexecv1.AgentExecution, path string) bool {
	for _, pa := range exec.GetStatus().GetPendingApprovals() {
		for _, fc := range pa.GetFileChanges() {
			if fc.GetPath() == path {
				return true
			}
		}
	}
	return false
}

// createCaptureSession creates a HARNESS_CURSOR session whose primary workspace
// is the given hermetic git work tree (via a LocalPathSource entry), which is
// what selects capture mode in the runner (isGitWorkTree).
func createCaptureSession(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	agentInstanceID, gitDir string,
) *sessionv1.Session {
	t.Helper()
	return harness.CreateTestSession(t, ctx, clients, agentInstanceID,
		sessionv1.Harness_HARNESS_CURSOR,
		harness.WithWorkspaceEntries([]*sessionv1.WorkspaceEntry{
			{
				Name: "repo",
				Source: &sessionv1.WorkspaceSource{
					Source: &sessionv1.WorkspaceSource_LocalPath{
						LocalPath: &sessionv1.LocalPathSource{Path: gitDir},
					},
				},
			},
		}),
	)
}

// findCaptureApprovalByPath returns the pending approval whose first file change
// targets path (capture cards carry exactly one file change), or nil.
func findCaptureApprovalByPath(exec *agentexecv1.AgentExecution, path string) *agentexecv1.PendingApproval {
	for _, pa := range exec.GetStatus().GetPendingApprovals() {
		for _, fc := range pa.GetFileChanges() {
			if fc.GetPath() == path {
				return pa
			}
		}
	}
	return nil
}

// findCaptureToolCall returns the persisted capture card tool call for path
// (synthesized with id "capture:<path>"), or nil. Used to assert a card's final
// status (COMPLETED when approved, SKIPPED when rejected) in place.
func findCaptureToolCall(exec *agentexecv1.AgentExecution, path string) *agentexecv1.ToolCall {
	wantID := "capture:" + path
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		if tc.GetId() == wantID {
			return tc
		}
	}
	return nil
}

// assertCaptureCardWholeFile asserts a capture approval carries a single
// WHOLE_FILE change for the expected path and returns it for content checks.
// Capture cards always present the git-derived whole-file before/after (never a
// HUNK), so the diff shown is the file's true net change for the turn.
func assertCaptureCardWholeFile(
	t *testing.T,
	approval *agentexecv1.PendingApproval,
	wantPath string,
) *agentexecv1.FileChange {
	t.Helper()
	require.NotEmpty(t, approval.GetFileChanges(),
		"a capture card must carry its proposed file change before approval")
	fc := approval.GetFileChanges()[0]
	assert.Equal(t, wantPath, fc.GetPath(), "capture card file path")
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
		fc.GetCaptureLevel(), "capture cards present the git-derived WHOLE_FILE net change")
	return fc
}

// hasDiscardSystemMessage reports whether the execution carries the SYSTEM
// message the runner appends when capture cards are discarded on reject.
func hasDiscardSystemMessage(exec *agentexecv1.AgentExecution) bool {
	for _, msg := range exec.GetStatus().GetMessages() {
		if msg.GetType() == agentexecv1.MessageType_MESSAGE_SYSTEM &&
			strings.Contains(strings.ToLower(msg.GetContent()), "discarded") {
			return true
		}
	}
	return false
}

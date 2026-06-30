//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// --- Offline Deep-Agent File-Review HITL Tests (PR 2.5) ---
//
// These prove the native (deep-agent) apply-then-review FileChangeSet loop end to
// end through the real system (Cloud/Java service + TS runner), with NO provider
// keys: the agent edits git-tracked files, the runner captures a baseline ->
// candidate diff and authors a FileChangeSet (AWAITING_REVIEW), the human
// keeps/discards each file via SubmitFileDecision, and the runner reconciles the
// approved bytes on resume — all reflected on status.file_change_sets and the
// append-only file_review_event_stream that both editions project from.
//
// Why this loop is faithfully testable offline (unlike a gated *tool* resume):
// a git-tracked edit FLOWS during the turn (no mid-turn interrupt), so turn 1 is
// a single graph invocation, and the resume that reconciles a PURE file review is
// deliberately checkpointer-independent — it reads the persisted transcript +
// the on-disk git refs + the server-persisted change set, never the LangGraph
// checkpoint (execute-deep-agent/index.ts). So the offline ephemeral MemorySaver
// is never exercised across the file-review boundary, and "no model
// re-invocation on a pure file approval" is provable as mockLLM.Remaining()==0
// (a wrongful re-run would request an unscripted entry -> 500 -> the execution
// would FAIL instead of COMPLETE).
//
// Determinism comes from scripting the exact LLM turns; capture mode is selected
// by attaching a real git work tree as a LocalPathSource workspace (the runner,
// co-located in MODE=local, operates in place -> isGitWorkTree is true), exactly
// as the live Cursor capture suite does.
//
// Deliberate boundary — the full MIXED-turn RESUME (a file edit plus a gitignored
// /shell/MCP gate in one turn) is NOT asserted here. Resolving the tool gate
// requires the durable checkpointer to resume the graph, which the offline
// MemorySaver replays from scratch. TestOffline_FileReview_MixedTurn therefore
// asserts only the GATE-TIME state (both review surfaces coexist) and cancels;
// the full mixed resolution stays covered by the runner unit tests and the live
// path.

// startFileReviewRun wires an offline native execution against a git workspace in
// capture mode and returns the handles a file-review test needs. The caller owns
// gitDir (typically harness.NewGitWorkspace) so it can seed tracked files first;
// auto_approve_all is always false so the approval gate (and its capture-mode
// branch) is active.
func startFileReviewRun(
	t *testing.T,
	ctx context.Context,
	gitDir string,
	entries []harness.RecordedLLMEntry,
	message string,
) (*harness.MockLLMProxyServer, *harness.Clients, *harness.AgentExecutionWaiter, string) {
	t.Helper()

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-filereview-"+t.Name(),
		"You are a test agent. Use the filesystem tools to write, edit, and delete files.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
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
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, message,
		harness.WithAutoApproveAll(false),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	return mockLLM, clients, waiter, exec.GetMetadata().GetId()
}

// writeFileTurn / editFileTurn / textTurn are the scripted LLM turns the tests
// compose, keyed so each test reads as the sequence of model actions it drives.
func writeFileTurn(idx int, toolID, path, content string) harness.RecordedLLMEntry {
	return harness.BuildLLMEntry(idx, harness.AnthropicToolUseResponse(
		toolID, "write_file",
		map[string]any{"file_path": path, "content": content},
		300, 40,
	))
}

func editFileTurn(idx int, toolID, path, oldStr, newStr string) harness.RecordedLLMEntry {
	return harness.BuildLLMEntry(idx, harness.AnthropicToolUseResponse(
		toolID, "edit_file",
		map[string]any{"file_path": path, "old_string": oldStr, "new_string": newStr},
		300, 40,
	))
}

func textTurn(idx int, text string) harness.RecordedLLMEntry {
	return harness.BuildLLMEntry(idx, harness.AnthropicTextResponse(text, 200, 20))
}

// TestOffline_FileReview_Approve_ReconcilesApprovedBytes is the headline guard:
// a git-tracked CREATE flows during the turn, surfaces as one AWAITING_REVIEW
// change set, and a FILE-scoped APPROVE reconciles the approved bytes onto disk
// with NO model re-invocation.
func TestOffline_FileReview_Approve_ReconcilesApprovedBytes(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	headBefore := harness.WorkspaceHeadSHA(t, gitDir)
	const path = "feature.txt"
	const content = "hello\nworld\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w1", path, content),
			textTurn(1, "Created the file."),
		},
		"Create feature.txt using the filesystem tools.")

	// --- Turn boundary: the edit flowed and is offered for review ---
	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, waiting, 0) // file review is the only surface; no tool gate

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "a tracked edit must surface one AWAITING_REVIEW change set")
	setID := set.GetId()
	assert.Equal(t, "deep-agent", set.GetHarnessId(), "the native harness must stamp harness_id=deep-agent")
	assert.NotEmpty(t, set.GetAggregateDigest(), "the change set must carry an aggregate digest")

	ch := harness.AssertCapturedChange(t, set, path, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
	require.NotNil(t, ch)
	assert.Nil(t, ch.GetBefore(), "an ADD has no before side")
	require.NotNil(t, ch.GetAfter(), "an ADD must carry the new content as after")
	assert.Equal(t, content, ch.GetAfter().GetInline(), "after should be the created content, inline")
	assert.NotEmpty(t, ch.GetAfterSha256(), "an ADD must carry the after sha256 (reconcile enforcement)")

	// The append-only ledger carries the producer's capture events.
	stream := waiting.GetStatus().GetFileReviewEventStream()
	assert.True(t, harness.FileReviewStreamHasEvent(stream, setID, agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED),
		"the ledger must carry BASELINE_CAPTURED for the set")
	assert.True(t, harness.FileReviewStreamHasEvent(stream, setID, agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED),
		"the ledger must carry CANDIDATE_CAPTURED for the set")

	// The flowed file-edit row is collapsed (file_change_sets is the single surface).
	if tc := harness.FindToolCall(waiting, "write_file"); tc != nil {
		assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_SKIPPED, tc.GetStatus(),
			"a flowed file-edit row must be hidden (SKIPPED) once captured for review")
	}

	// --- Decision: keep the file ---
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)

	result, err := waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "approving the only file must complete the execution")

	// --- Postconditions: approved bytes on disk, reconciled, no re-run, no commit ---
	assert.Equal(t, content, harness.ReadWorkspaceFile(t, gitDir, path),
		"the approved bytes must be reconciled onto disk verbatim")
	assert.True(t, harness.FileReviewStreamHasEvent(result.GetStatus().GetFileReviewEventStream(), setID,
		agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED),
		"the ledger must carry RECONCILED after approval")
	assert.Equal(t, headBefore, harness.WorkspaceHeadSHA(t, gitDir),
		"capture mode must never move HEAD (no commit)")
	assert.Equal(t, 0, mockLLM.Remaining(),
		"a pure file-review approval must NOT re-invoke the model (every scripted entry consumed exactly once in turn 1)")
}

// TestOffline_FileReview_Reject_SnapsBackByteForByte proves a discard COMPLETES
// (it is not a failure) and restores the file byte-for-byte to its pre-turn
// content, with no model re-invocation.
func TestOffline_FileReview_Reject_SnapsBackByteForByte(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const path = "notes.md"
	const original = "# Notes\noriginal line\n"
	harness.SeedWorkspaceFile(t, gitDir, path, original)
	headBefore := harness.WorkspaceHeadSHA(t, gitDir)

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			editFileTurn(0, "toolu_e1", path, "original line", "changed line"),
			textTurn(1, "Edited the file."),
		},
		"Edit notes.md using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "a tracked edit must surface one AWAITING_REVIEW change set")
	setID := set.GetId()

	ch := harness.AssertCapturedChange(t, set, path, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_MODIFY)
	require.NotNil(t, ch)
	require.NotNil(t, ch.GetBefore(), "a MODIFY must carry the pre-edit content as before")
	assert.Equal(t, original, ch.GetBefore().GetInline(), "before should be the seeded content")

	// --- Decision: discard the file ---
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)

	result, err := waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "a reject is a discard that COMPLETES, not a failure")

	assert.Equal(t, original, harness.ReadWorkspaceFile(t, gitDir, path),
		"a rejected edit must snap the file back byte-for-byte to its pre-turn content")
	assert.True(t, harness.FileReviewStreamHasEvent(result.GetStatus().GetFileReviewEventStream(), setID,
		agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED),
		"the ledger must carry RECONCILED after the discard is reconciled")
	assert.Equal(t, headBefore, harness.WorkspaceHeadSHA(t, gitDir), "capture mode must never move HEAD")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review reject must NOT re-invoke the model")
}

// TestOffline_FileReview_PartialDecision_OnlyApprovedLands proves per-file
// granularity: in a two-file change set, an APPROVE and a REJECT land only the
// approved file; the rejected one is snapped back (here, never created).
func TestOffline_FileReview_PartialDecision_OnlyApprovedLands(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const keepPath = "keep.txt"
	const dropPath = "drop.txt"
	const keepBody = "keep me\n"
	const dropBody = "drop me\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_keep", keepPath, keepBody),
			writeFileTurn(1, "toolu_w_drop", dropPath, dropBody),
			textTurn(2, "Created both files."),
		},
		"Create keep.txt and drop.txt using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "two tracked creates must surface one AWAITING_REVIEW change set")
	require.Len(t, set.GetChanges(), 2, "the change set must carry both captured creates")
	harness.AssertCapturedChange(t, set, keepPath, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
	harness.AssertCapturedChange(t, set, dropPath, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)

	// --- Decisions: keep one, discard the other ---
	result, err := waiter.ResolveFileDecisionsByPathUntilPhase(t, ctx, clients, execID,
		func(path string) agentexecv1.FileDecisionAction {
			if path == keepPath {
				return agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE
			}
			return agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT
		},
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "deciding every file must complete the execution")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	assert.Equal(t, keepBody, harness.ReadWorkspaceFile(t, gitDir, keepPath),
		"the approved file must be reconciled onto disk")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, dropPath),
		"the rejected create must be snapped back (the file must not exist)")
	assert.Equal(t, 0, mockLLM.Remaining(), "partial file review must NOT re-invoke the model")
}

// TestOffline_FileReview_ChangeSetScope_KeepAll proves the "Keep all" path: one
// CHANGE_SET-scoped APPROVE (echoing the aggregate_digest) covers every change.
func TestOffline_FileReview_ChangeSetScope_KeepAll(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const aPath = "alpha.txt"
	const bPath = "beta.txt"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_a", aPath, "alpha\n"),
			writeFileTurn(1, "toolu_w_b", bPath, "beta\n"),
			textTurn(2, "Created both files."),
		},
		"Create alpha.txt and beta.txt using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set)
	require.Len(t, set.GetChanges(), 2)

	// One change-set-scoped decision covers all files.
	harness.SubmitChangeSetDecision(t, ctx, clients, execID, set,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)

	result, err := waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "a change-set-scoped approval must complete the execution")
	assert.True(t, harness.FileReviewStreamHasEvent(result.GetStatus().GetFileReviewEventStream(), set.GetId(),
		agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED), "the set must reconcile")

	assert.Equal(t, "alpha\n", harness.ReadWorkspaceFile(t, gitDir, aPath))
	assert.Equal(t, "beta\n", harness.ReadWorkspaceFile(t, gitDir, bPath))
	assert.Equal(t, 0, mockLLM.Remaining(), "change-set approval must NOT re-invoke the model")
}

// TestOffline_FileReview_ExpectedDigestMismatch_Rejected proves the
// "what-you-approve-is-what-applies" enforcement gate: a decision carrying a
// stale expected_digest is rejected with INVALID_ARGUMENT and changes nothing;
// a subsequent correct decision still completes the review.
func TestOffline_FileReview_ExpectedDigestMismatch_Rejected(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const path = "config.txt"
	const content = "key=value\n"

	_, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_cfg", path, content),
			textTurn(1, "Created the file."),
		},
		"Create config.txt using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set)
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch)

	// A stale/forged digest must be rejected with INVALID_ARGUMENT.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   "sha256:stale-digest-the-user-never-saw",
	})
	require.Error(t, err, "a stale expected_digest must be rejected")
	assert.Equal(t, codes.InvalidArgument, status.Code(err),
		"a digest mismatch is the caller's fault (INVALID_ARGUMENT), not a precondition failure")

	// The execution is untouched: still awaiting review.
	stillWaiting, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: execID})
	require.NoError(t, err)
	harness.AssertAgentPhase(t, stillWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotNil(t, harness.FindFileChangeSet(stillWaiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW),
		"a rejected decision must leave the set awaiting review")

	// The correct digest still works.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)
	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "the correct-digest decision must complete the review")
	assert.Equal(t, content, harness.ReadWorkspaceFile(t, gitDir, path))
}

// TestOffline_FileReview_GitignoredStaysGated proves the gitignore-aware capture
// gate: a write to a .gitignore'd path cannot be captured/reverted by the git
// substrate, so it stays a true-paused TOOL approval — never a FileChangeSet.
func TestOffline_FileReview_GitignoredStaysGated(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t) // seeds .gitignore with .env and .stigmer/
	const path = ".env"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_env", path, "SECRET=1\n"),
			textTurn(1, "Wrote the env file."),
		},
		"Write the .env file using the filesystem tools.")

	// A gitignored write must surface as a tool approval, not a change set.
	gate, err := waiter.WaitForPendingApproval(ctx, execID, "write_file", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("a gitignored write should gate as a tool approval: %v", err)
	}
	harness.AssertAgentPhase(t, gate, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	assert.Equal(t, 0,
		harness.CountChangeSets(gate, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW),
		"a gitignored edit must NOT be captured as a reviewable change set")
	harness.AssertPendingApprovalFileChange(t, gate, "write_file", path,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)

	// Approving the tool gate drives a clean terminal state (one LLM call per
	// gated turn — the offline tool-gate resume contract).
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: execID,
		ToolCallId:       gate.GetStatus().GetPendingApprovals()[0].GetToolCallId(),
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoError(t, err, "approve the gitignored write gate")

	result, err := waiter.WaitForTerminal(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "execution should complete after the tool gate is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	assert.Equal(t, 0, mockLLM.Remaining(), "all scripted entries consumed")
}

// TestOffline_FileReview_MixedTurn_BothSurfacesCoexist proves a single turn can
// block on BOTH review surfaces at once: a git-tracked edit flows and is captured
// (file review) while a gitignored edit true-pauses (tool gate). Only the
// GATE-TIME state is asserted; the full mixed RESUME is the deferred boundary
// documented at the top of this file, so the test cancels rather than resolving.
func TestOffline_FileReview_MixedTurn_BothSurfacesCoexist(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const trackedPath = "tracked.txt"
	const ignoredPath = ".env"

	_, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			// Tracked edit flows (captured), THEN the gitignored edit gates.
			writeFileTurn(0, "toolu_w_tracked", trackedPath, "tracked body\n"),
			writeFileTurn(1, "toolu_w_ignored", ignoredPath, "SECRET=1\n"),
			textTurn(2, "Wrote both files."),
		},
		"Write tracked.txt then .env using the filesystem tools.")

	// At the gitignored gate, both surfaces must be present.
	gate, err := waiter.WaitForPendingApproval(ctx, execID, "write_file", 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("the mixed turn should gate on the gitignored write: %v", err)
	}
	harness.AssertAgentPhase(t, gate, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

	// Surface 1: the tracked edit is awaiting file review.
	set := harness.FindFileChangeSet(gate, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the tracked edit must be captured as an AWAITING_REVIEW change set")
	require.NotNil(t, harness.FindCapturedChangeByPath(set, trackedPath),
		"the captured set must contain the tracked file")

	// Surface 2: the gitignored edit is a true-paused tool approval.
	harness.AssertPendingApprovals(t, gate, 1)
	harness.AssertPendingApprovalFileChange(t, gate, "write_file", ignoredPath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)

	// Deferred boundary: do not resolve the mixed turn offline (the tool-gate
	// resume needs the durable checkpointer). Cancel for a clean teardown.
	_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id:     execID,
		Reason: "offline mixed-turn test asserts gate-time state only",
	})
	require.NoError(t, err, "cancel the unresolved mixed-turn execution")
}

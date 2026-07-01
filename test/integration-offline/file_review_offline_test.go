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
// Mixed turns — a file edit combined with a *secret-like gitignored* write (.env)
// resolve FULLY offline, because DD-E hard-blocks the secret write (no tool gate):
// the turn is a pure file review over one PARTIAL_BLOCKED set (see
// TestOffline_FileReview_MixedTurn_TrackedKeptSecretDiscarded). A mixed turn with
// an actual mid-turn TOOL gate (shell / MCP / a gitignored delete) is still NOT
// resolved here: resuming that gate needs the durable checkpointer the offline
// MemorySaver replays from scratch, so it stays covered by the runner unit tests
// and the live path.

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

// TestOffline_FileReview_ApproveBlockedOnIncompleteDiff proves the completeness
// gate end to end: a binary git-tracked file surfaces as a PARTIAL_BLOCKED change
// set whose file is not reviewable, so an APPROVE is refused with
// FAILED_PRECONDITION and leaves the set awaiting review, while a REJECT discards
// it and completes. This is the honest "you cannot keep what you could not
// review" contract wired through the real SubmitFileDecision RPC.
func TestOffline_FileReview_ApproveBlockedOnIncompleteDiff(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const path = "blob.bin"
	// A NUL byte makes the captured content binary (looksBinary), so the runner
	// flags the file diff_complete=false and the whole set PARTIAL_BLOCKED — the
	// diff cannot be rendered for review.
	const content = "\x00binary\x00payload\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_bin", path, content),
			textTurn(1, "Wrote the binary asset."),
		},
		"Create the binary asset using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "a binary create must still surface an AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"a binary file must mark the set PARTIAL_BLOCKED (its diff is not reviewable)")
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the binary file must be captured for review")
	assert.False(t, ch.GetDiffComplete(), "the binary file must be flagged diff_complete=false")

	// APPROVE is refused: a diff that was never reviewable cannot be kept.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   ch.GetFileDigest(),
	})
	require.Error(t, err, "approving an unreviewable (binary) diff must be refused")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"an unreviewable-diff approval is a precondition failure, not INVALID_ARGUMENT")

	// The execution is untouched: still awaiting review.
	stillWaiting, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: execID})
	require.NoError(t, err)
	harness.AssertAgentPhase(t, stillWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotNil(t, harness.FindFileChangeSet(stillWaiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW),
		"a blocked approval must leave the set awaiting review")

	// REJECT is always allowed: discard the unreviewable change and complete.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)
	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "rejecting the unreviewable change must complete the execution")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, path),
		"the rejected binary create must be snapped back (the file must not exist)")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review decision must NOT re-invoke the model")
}

// TestOffline_FileReview_SecretGitignored_HardBlockedDiscardOnly proves the DD-E
// contract: a secret-like gitignored write (.env) is hard-blocked — never
// applied, never captured — and surfaces as a content-less DIFF_UNREVIEWABLE
// entry in a PARTIAL_BLOCKED change set (NOT a tool approval). It cannot be
// approved (nothing was reviewable), only discarded, after which the execution
// completes with the file never having touched disk.
func TestOffline_FileReview_SecretGitignored_HardBlockedDiscardOnly(t *testing.T) {
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

	// The secret-like write is hard-blocked (no interrupt), so the turn runs to
	// completion and the boundary opens a file review — never a tool gate.
	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("a hard-blocked secret write should still open a file review: %v", err)
	}
	harness.AssertPendingApprovals(t, waiting, 0) // never a tool approval

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the secret-blocked write must surface an AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"a secret-blocked path must mark the set PARTIAL_BLOCKED (its diff is not reviewable)")

	// The entry is content-less: no before/after bytes, diff_complete=false,
	// captured as GIT_IGNORED_CAPTURED. Its file_digest is derived from path+kind
	// (not content), so it is non-empty and the entry is still addressable.
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the secret path must be surfaced (path only) for review")
	assert.False(t, ch.GetDiffComplete(), "a secret-blocked entry must be diff_complete=false")
	assert.Equal(t, agentexecv1.FileCaptureClass_FILE_CAPTURE_CLASS_GIT_IGNORED_CAPTURED, ch.GetCaptureClass(),
		"a secret-blocked gitignored path is captured as GIT_IGNORED_CAPTURED")
	assert.Nil(t, ch.GetAfter(), "the secret content must never enter the ledger")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, path),
		"a hard-blocked secret write must never touch disk")

	// APPROVE is refused: a diff that was never reviewable cannot be kept
	// (completeness gate, before the digest check).
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   ch.GetFileDigest(),
	})
	require.Error(t, err, "approving an unreviewable secret entry must be refused")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"an unreviewable-diff approval is a precondition failure")

	// The execution is untouched: still awaiting review.
	stillWaiting, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: execID})
	require.NoError(t, err)
	harness.AssertAgentPhase(t, stillWaiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)

	// REJECT (discard) is always allowed: complete, with the file still absent.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)
	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "discarding the unreviewable secret entry must complete the execution")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, path),
		"the rejected secret write must remain absent")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review decision must NOT re-invoke the model")
}

// TestOffline_FileReview_MixedTurn_TrackedKeptSecretDiscarded proves a single
// turn that touches a git-tracked file (flows, reviewable) AND a secret-like
// gitignored file (.env, hard-blocked) yields ONE file-review surface — a
// PARTIAL_BLOCKED set holding the reviewable tracked change plus the content-less
// DIFF_UNREVIEWABLE entry — with NO tool approval. Because the secret path no
// longer gates, the turn is fully resolvable offline: FILE-approve the (complete)
// tracked file, FILE-discard .env, and the runner reconciles with no model re-run.
func TestOffline_FileReview_MixedTurn_TrackedKeptSecretDiscarded(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const trackedPath = "tracked.txt"
	const ignoredPath = ".env"
	const trackedBody = "tracked body\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_tracked", trackedPath, trackedBody),
			writeFileTurn(1, "toolu_w_ignored", ignoredPath, "SECRET=1\n"),
			textTurn(2, "Wrote both files."),
		},
		"Write tracked.txt then .env using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("the mixed turn should open a file review: %v", err)
	}
	// One surface only: no tool approval (the secret write was hard-blocked).
	harness.AssertPendingApprovals(t, waiting, 0)

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the mixed turn must surface one AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"the secret entry makes the whole set PARTIAL_BLOCKED")

	// The tracked change is reviewable (complete, with content)...
	tracked := harness.AssertCapturedChange(t, set, trackedPath, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
	require.NotNil(t, tracked)
	assert.True(t, tracked.GetDiffComplete(), "the tracked file must be diff_complete")

	// ...while the secret entry is content-less and unreviewable.
	secret := harness.FindCapturedChangeByPath(set, ignoredPath)
	require.NotNil(t, secret, "the secret path must be surfaced (path only)")
	assert.False(t, secret.GetDiffComplete(), "the secret entry must be diff_complete=false")

	// Per-file: keep the (complete) tracked file, discard the secret entry. A
	// per-file APPROVE of a complete file is allowed even in a PARTIAL_BLOCKED set.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, trackedPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, ignoredPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)

	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "deciding both changes must complete the mixed turn")

	assert.Equal(t, trackedBody, harness.ReadWorkspaceFile(t, gitDir, trackedPath),
		"the kept tracked file must reconcile to its approved bytes")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, ignoredPath),
		"the discarded secret write must never exist on disk")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review resolution must NOT re-invoke the model")
}

// TestOffline_FileReview_GitignoredCaptured_ReviewedAndReconciled is the headline
// CAS guard: a NON-secret gitignored write is not gated — it flows and is captured
// into content-addressed storage (GIT_IGNORED_CAPTURED, diff_complete) alongside a
// git-tracked edit in one HYBRID change set. A per-file APPROVE reconciles the CAS
// bytes back onto disk (through the runner's real getDownloadUrl+fetch read path,
// which the harness now serves), a per-file REJECT snaps a captured create back
// out, and no model re-invocation occurs.
func TestOffline_FileReview_GitignoredCaptured_ReviewedAndReconciled(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedGitignorePattern(t, gitDir, "cache/") // a non-secret ignored dir → CAS-captured
	const trackedPath = "tracked.txt"
	const keepPath = "cache/keep.txt"
	const dropPath = "cache/drop.txt"
	const trackedBody = "tracked body\n"
	const keepBody = "cache keep body\n"
	const dropBody = "cache drop body\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_tracked", trackedPath, trackedBody),
			writeFileTurn(1, "toolu_w_keep", keepPath, keepBody),
			writeFileTurn(2, "toolu_w_drop", dropPath, dropBody),
			textTurn(3, "Wrote a tracked file and two ignored files."),
		},
		"Write tracked.txt and two files under cache/ using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("the CAS capture turn should open a file review: %v", err)
	}
	// No tool gate: a non-secret gitignored write flows just like a tracked one.
	harness.AssertPendingApprovals(t, waiting, 0)

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the turn must surface one AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE, set.GetDiffCompleteness(),
		"every change is reviewable text, so the hybrid set is COMPLETE")
	assert.NotEmpty(t, set.GetAggregateDigest(), "the hybrid change set must carry an aggregate digest")

	// The tracked edit is captured by the git substrate...
	tracked := harness.AssertCapturedChange(t, set, trackedPath, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
	require.NotNil(t, tracked)
	assert.Equal(t, agentexecv1.FileCaptureClass_FILE_CAPTURE_CLASS_GIT_TRACKED, tracked.GetCaptureClass(),
		"a tracked file is captured as GIT_TRACKED")

	// ...and each ignored file by the CAS substrate (reviewable, complete).
	for _, p := range []string{keepPath, dropPath} {
		ch := harness.AssertCapturedChange(t, set, p, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
		require.NotNilf(t, ch, "cas change for %s", p)
		assert.Equalf(t, agentexecv1.FileCaptureClass_FILE_CAPTURE_CLASS_GIT_IGNORED_CAPTURED, ch.GetCaptureClass(),
			"%s is a gitignored path captured into CAS", p)
		assert.Truef(t, ch.GetDiffComplete(), "%s is reviewable text, so diff_complete", p)
	}

	// Keep the tracked file and one ignored file; discard the other ignored file.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, trackedPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, keepPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, dropPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)

	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "deciding every change must complete the turn")

	assert.Equal(t, trackedBody, harness.ReadWorkspaceFile(t, gitDir, trackedPath),
		"the kept tracked file must reconcile to its approved bytes")
	assert.Equal(t, keepBody, harness.ReadWorkspaceFile(t, gitDir, keepPath),
		"the kept ignored file must reconcile byte-exact from its CAS blob")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, dropPath),
		"the discarded ignored create must be snapped back out of the working tree")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review resolution must NOT re-invoke the model")
}

// TestOffline_FileReview_Durability_ReconcilesAfterWorkingTreeWiped proves the
// durability contract (design doc 11, D3): a decision reconciles from the DURABLE
// stores alone — the git object store (.git) for tracked files and the CAS blob
// store (the artifact dir) for ignored files — even if the working tree is lost
// between capture and decision. It models a sandbox recycle by deleting the
// captured working files (keeping .git + the artifact dir) before approving, then
// asserts both are restored byte-exact.
func TestOffline_FileReview_Durability_ReconcilesAfterWorkingTreeWiped(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedGitignorePattern(t, gitDir, "cache/")
	const trackedPath = "tracked.txt"
	const ignoredPath = "cache/data.txt"
	const trackedBody = "durable tracked body\n"
	const ignoredBody = "durable cas body\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_tracked", trackedPath, trackedBody),
			writeFileTurn(1, "toolu_w_ignored", ignoredPath, ignoredBody),
			textTurn(2, "Wrote a tracked and an ignored file."),
		},
		"Write tracked.txt and cache/data.txt using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("the capture turn should open a file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the turn must surface one AWAITING_REVIEW change set")

	// Both files were captured (git ref for the tracked, CAS blob for the ignored)
	// before we wipe the working tree.
	require.NotNil(t, harness.FindCapturedChangeByPath(set, trackedPath), "tracked file captured")
	require.NotNil(t, harness.FindCapturedChangeByPath(set, ignoredPath), "ignored file captured")

	// Recycle: drop the working copies, keeping .git and the artifact dir. The
	// reconcile must now reconstruct purely from the durable stores.
	harness.RemoveWorkspaceFile(t, gitDir, trackedPath)
	harness.RemoveWorkspaceFile(t, gitDir, ignoredPath)
	require.False(t, harness.WorkspaceFileExists(t, gitDir, trackedPath), "tracked working copy wiped")
	require.False(t, harness.WorkspaceFileExists(t, gitDir, ignoredPath), "ignored working copy wiped")

	// Keep everything: one CHANGE_SET-scoped approve over the (COMPLETE) set.
	harness.SubmitChangeSetDecision(t, ctx, clients, execID, set,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)

	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "approving the set must complete the execution")

	assert.Equal(t, trackedBody, harness.ReadWorkspaceFile(t, gitDir, trackedPath),
		"the tracked file must be restored byte-exact from the git object store")
	assert.Equal(t, ignoredBody, harness.ReadWorkspaceFile(t, gitDir, ignoredPath),
		"the ignored file must be restored byte-exact from its durable CAS blob")
	assert.Equal(t, 0, mockLLM.Remaining(), "reconcile from durable stores must NOT re-invoke the model")
}

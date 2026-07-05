//go:build integration

package offline

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
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
	mockLLM, clients, waiter, _, execID := startFileReviewRunOpts(t, ctx, gitDir, entries, message, false)
	return mockLLM, clients, waiter, execID
}

// startFileReviewRunOpts is startFileReviewRun with the knobs a few tests need:
// `autoApproveAll` selects the global bypass (no approval gate installed), and
// the runner manager is returned so a test can reach its LocalArtifactDir to
// assert on what did — or must never — reach durable storage.
func startFileReviewRunOpts(
	t *testing.T,
	ctx context.Context,
	gitDir string,
	entries []harness.RecordedLLMEntry,
	message string,
	autoApproveAll bool,
) (*harness.MockLLMProxyServer, *harness.Clients, *harness.AgentExecutionWaiter, *harness.UnifiedRunnerManager, string) {
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
		harness.WithAutoApproveAll(autoApproveAll),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	return mockLLM, clients, waiter, mgr, exec.GetMetadata().GetId()
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

	// The flowed file-edit row stays VISIBLE at its transcript position as an
	// observational record, stamped with the change set id it contributed to
	// (file_change_sets remains the single DECISION surface). The projected set
	// id and the row's stamp must agree end to end through the real service.
	tc := harness.FindToolCall(waiting, "write_file")
	require.NotNil(t, tc, "the flowed file-edit row must remain in the transcript")
	assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, tc.GetStatus(),
		"a flowed file-edit row stays COMPLETED (visible in place), never hidden")
	assert.Equal(t, setID, tc.GetFileChangeSetId(),
		"the row's stamp must reference exactly the projected change set")
	assert.NotNil(t, tc.GetArgs(),
		"an observational row keeps its args (the per-edit preview the user watched)")

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

	// The audit trail survives the discard: the stamped row stays in the
	// transcript, still referencing its (now reconciled) change set — "the agent
	// edited this file here, and the edit was later discarded".
	if tc := harness.FindToolCall(result, "edit_file"); assert.NotNil(t, tc) {
		assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, tc.GetStatus(),
			"a rejected turn's edit row remains a visible historical record")
		assert.Equal(t, setID, tc.GetFileChangeSetId(),
			"the row's stamp must survive reconcile")
	}
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
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY, set.GetDiffCompleteness(),
		"a binary-only set is BINARY_SUMMARY_ONLY (binary is its only blocker, DD-17)")
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the binary file must be captured for review")
	assert.False(t, ch.GetDiffComplete(), "the binary file must be flagged diff_complete=false")
	// The binary side is captured as a body-less, byte-true content address (it
	// reconciles from the git ref, never the wire) — proving the shape survives
	// persist -> project through the real service. is_binary is the single signal
	// consumers key off (the SDK renders "binary file changed"; the Slice-B gate
	// reads it), and the after sha256 is the byte-true enforcement digest.
	require.NotNil(t, ch.GetAfter(), "a binary ADD still carries an after FileContent (flagged, body-less)")
	assert.True(t, ch.GetAfter().GetIsBinary(), "the binary side must be flagged is_binary")
	assert.Empty(t, ch.GetAfter().GetInline(), "a binary side carries no inline body (no lossy text)")
	assert.NotEmpty(t, ch.GetAfterSha256(), "the binary must carry a byte-true after sha256")

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

// TestOffline_FileReview_BinaryAcknowledgedApprove_ReconcilesBytes proves the
// binary-acknowledgment carve-out (DD-16) end to end through the real service: a
// binary file is discard-only until the user consciously acknowledges it, at
// which point a FILE-scoped APPROVE with acknowledge_unreviewable=true is
// accepted and the runner reconciles its exact bytes onto disk. It also proves
// the carve-out never relaxes the digest gate (a stale digest still fails).
func TestOffline_FileReview_BinaryAcknowledgedApprove_ReconcilesBytes(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	headBefore := harness.WorkspaceHeadSHA(t, gitDir)
	const path = "assets/logo.bin"
	// A NUL byte makes the captured content binary (bytesLookBinary), so the file
	// is diff_complete=false and the set PARTIAL_BLOCKED — no text diff to review.
	const content = "\x00PNG\x00\x01\x02keep-me\n"

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
	require.NotNil(t, set, "a binary create must surface an AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY, set.GetDiffCompleteness())
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the binary file must be captured for review")
	require.True(t, ch.GetAfter().GetIsBinary(), "the captured side must be flagged is_binary")

	// A plain APPROVE (no acknowledgment) is still refused — discard-only by default.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   ch.GetFileDigest(),
	})
	require.Error(t, err, "approving a binary without acknowledgment must be refused")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))

	// An acknowledged APPROVE with a STALE digest still fails the digest gate —
	// the carve-out relaxes completeness only, never "what you approve is applied".
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId:        execID,
		ChangeSetId:             set.GetId(),
		Scope:                   agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:            ch.GetId(),
		Action:                  agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:          "stale-digest-user-never-saw",
		AcknowledgeUnreviewable: true,
	})
	require.Error(t, err, "an acknowledged approve with a stale digest must still fail")
	assert.Equal(t, codes.InvalidArgument, status.Code(err),
		"the digest gate is INVALID_ARGUMENT, proving completeness passed first")

	// The acknowledged APPROVE (fresh digest) is accepted and reconciles.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId:        execID,
		ChangeSetId:             set.GetId(),
		Scope:                   agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:            ch.GetId(),
		Action:                  agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:          ch.GetFileDigest(),
		AcknowledgeUnreviewable: true,
	})
	require.NoError(t, err, "an acknowledged binary approve must be accepted")

	result, err := waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "the acknowledged approval must complete the execution")

	// The exact binary bytes are reconciled onto disk (byte-true, from the git ref).
	assert.Equal(t, content, harness.ReadWorkspaceFile(t, gitDir, path),
		"the acknowledged binary must be reconciled onto disk byte-for-byte")
	assert.True(t, harness.FileReviewStreamHasEvent(result.GetStatus().GetFileReviewEventStream(), set.GetId(),
		agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED),
		"the ledger must carry RECONCILED after the acknowledged approval")
	assert.Equal(t, headBefore, harness.WorkspaceHeadSHA(t, gitDir), "capture mode must never move HEAD")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review decision must NOT re-invoke the model")
}

// TestOffline_FileReview_BinarySummaryOnly_KeepAll_ReconcilesBytes proves the
// set-level "Keep all" carve-out (DD-17) end to end: a turn that edits a
// reviewable text file AND writes a binary file surfaces as ONE
// BINARY_SUMMARY_ONLY change set (binary is the set's only blocker). A plain
// CHANGE_SET approve is refused, but a CHANGE_SET approve carrying
// acknowledge_unreviewable=true keeps the whole set in one action, reconciling
// BOTH files' exact bytes — the text from the git ref and the binary byte-true —
// with no model re-invocation. The carve-out never relaxes the digest gate.
func TestOffline_FileReview_BinarySummaryOnly_KeepAll_ReconcilesBytes(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	headBefore := harness.WorkspaceHeadSHA(t, gitDir)
	const textPath = "README.md"
	const textBody = "# Title\nupdated\n"
	const binPath = "assets/logo.bin"
	// A NUL byte makes the captured content binary (bytesLookBinary), so the file
	// is diff_complete=false — the set's only blocker.
	const binBody = "\x00PNG\x00\x01\x02keep-me\n"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_text", textPath, textBody),
			writeFileTurn(1, "toolu_bin", binPath, binBody),
			textTurn(2, "Wrote a text file and a binary asset."),
		},
		"Create README.md and the binary asset using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("execution should reach file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the mixed text+binary turn must surface one AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY, set.GetDiffCompleteness(),
		"binary is the set's only blocker, so the rollup is BINARY_SUMMARY_ONLY (DD-17)")
	// The text file is reviewable; the binary is flagged incomplete-but-keepable.
	textCh := harness.AssertCapturedChange(t, set, textPath, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD)
	require.NotNil(t, textCh)
	assert.True(t, textCh.GetDiffComplete(), "the text file must be reviewable (diff_complete)")
	binCh := harness.FindCapturedChangeByPath(set, binPath)
	require.NotNil(t, binCh, "the binary file must be captured for review")
	assert.True(t, binCh.GetAfter().GetIsBinary(), "the binary side must be flagged is_binary")

	// A plain CHANGE_SET approve (no acknowledgment) is refused — the set is not
	// fully reviewable, so it cannot be kept as if COMPLETE.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   set.GetAggregateDigest(),
	})
	require.Error(t, err, "a whole-set approve of a binary-only set without acknowledgment must be refused")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"an unacknowledged keep-all is a precondition failure")

	// The acknowledged CHANGE_SET approve ("Keep all") is accepted and reconciles
	// the whole set: text + binary bytes both land byte-exact.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId:        execID,
		ChangeSetId:             set.GetId(),
		Scope:                   agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:                  agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:          set.GetAggregateDigest(),
		AcknowledgeUnreviewable: true,
	})
	require.NoError(t, err, "an acknowledged CHANGE_SET keep-all of a binary-only set must be accepted")

	result, err := waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "the acknowledged keep-all must complete the execution")

	assert.Equal(t, textBody, harness.ReadWorkspaceFile(t, gitDir, textPath),
		"the reviewable text file must be reconciled onto disk verbatim")
	assert.Equal(t, binBody, harness.ReadWorkspaceFile(t, gitDir, binPath),
		"the acknowledged binary must be reconciled onto disk byte-for-byte")
	assert.True(t, harness.FileReviewStreamHasEvent(result.GetStatus().GetFileReviewEventStream(), set.GetId(),
		agentexecv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED),
		"the ledger must carry RECONCILED after the keep-all")
	assert.Equal(t, headBefore, harness.WorkspaceHeadSHA(t, gitDir), "capture mode must never move HEAD")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review keep-all must NOT re-invoke the model")
}

// TestOffline_FileReview_BinaryPlusSecret_KeepAllStillBlocked proves the gate
// re-derives "binary-only" from the actual changes, not the rollup label: a turn
// with a reviewable text file, a binary file, AND a secret-like gitignored write
// (.env, hard-blocked, content-less) is PARTIAL_BLOCKED — the secret is a
// non-binary incompleteness. An acknowledged CHANGE_SET keep-all is REFUSED
// (a secret must never ride along in a bulk keep); the turn is still resolved
// per file: keep the text, keep-anyway the binary, discard the secret.
func TestOffline_FileReview_BinaryPlusSecret_KeepAllStillBlocked(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t) // seeds .gitignore with .env
	const textPath = "notes.md"
	const textBody = "kept notes\n"
	const binPath = "assets/pic.bin"
	const binBody = "\x00JPG\x00keep\n"
	const secretPath = ".env"

	mockLLM, clients, waiter, execID := startFileReviewRun(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_text", textPath, textBody),
			writeFileTurn(1, "toolu_bin", binPath, binBody),
			writeFileTurn(2, "toolu_env", secretPath, "SECRET=1\n"),
			textTurn(3, "Wrote a text file, a binary, and an env file."),
		},
		"Write notes.md, a binary asset, then .env using the filesystem tools.")

	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("the mixed turn should open a file review: %v", err)
	}
	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the mixed turn must surface one AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"a non-binary incompleteness (the withheld secret) makes the set PARTIAL_BLOCKED, not BINARY_SUMMARY_ONLY")

	// An acknowledged CHANGE_SET keep-all is REFUSED: the gate re-derives from the
	// changes and finds a non-binary incomplete entry (the secret), so a bulk keep
	// can never sweep it along.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId:        execID,
		ChangeSetId:             set.GetId(),
		Scope:                   agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:                  agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:          set.GetAggregateDigest(),
		AcknowledgeUnreviewable: true,
	})
	require.Error(t, err, "an acknowledged keep-all must be refused when a non-binary file is unreviewable")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"the keep-all re-derivation blocks a secret-bearing set (precondition failure)")

	// The turn is still resolvable per file: keep the text, keep-anyway the binary
	// (acknowledged FILE approve), discard the secret.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, textPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE)
	binCh := harness.FindCapturedChangeByPath(set, binPath)
	require.NotNil(t, binCh, "the binary file must be captured for review")
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId:        execID,
		ChangeSetId:             set.GetId(),
		Scope:                   agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:            binCh.GetId(),
		Action:                  agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:          binCh.GetFileDigest(),
		AcknowledgeUnreviewable: true,
	})
	require.NoError(t, err, "an acknowledged FILE approve of the binary must be accepted")
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, secretPath,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)

	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "deciding every change must complete the turn")

	assert.Equal(t, textBody, harness.ReadWorkspaceFile(t, gitDir, textPath),
		"the kept text file must reconcile to its approved bytes")
	assert.Equal(t, binBody, harness.ReadWorkspaceFile(t, gitDir, binPath),
		"the acknowledged binary must reconcile byte-for-byte")
	assert.False(t, harness.WorkspaceFileExists(t, gitDir, secretPath),
		"the discarded secret write must never exist on disk")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review resolution must NOT re-invoke the model")
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

// TestOffline_FileReview_TrackedSecret_ContentWithheldNeverPersisted proves the
// DD-26 follow-up #3 fix. A git-TRACKED secret-like file (a committed
// credentials.json) that the agent edits FLOWS in capture mode — the gate allows
// tracked mutations with no secret check (unlike a gitignored secret, which is
// hard-blocked at the gate) — so its bytes reach the turn boundary in the git
// diff. The capture seam must withhold them: the ledger entry is content-less
// (SECRET_WITHHELD / GIT_TRACKED), the set is PARTIAL_BLOCKED (approval refused),
// NEITHER the pre-edit (baseline) NOR the new secret bytes appear in the persisted
// status or artifact storage, and a REJECT reverts the file byte-exact to its
// committed baseline (NOT deleted). This is EXPLICITLY distinct from
// MixedTurn_TrackedKeptSecretDiscarded, whose secret is a *gitignored* .env and
// whose tracked file is *non-secret*. It would FAIL before the fix (the git diff
// carried the inline body straight into the CANDIDATE change).
func TestOffline_FileReview_TrackedSecret_ContentWithheldNeverPersisted(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	const path = "config/credentials.json" // tracked, NOT gitignored
	// Distinctive tokens so a substring scan cannot false-positive on the path;
	// each appears both in the file content AND in the edit's tool args.
	const oldToken = "OLDSECRETtoken111"
	const newToken = "NEWSECRETtoken222"
	const baselineSecret = "API_KEY=sk-live-" + oldToken + "\n"
	const newSecret = "API_KEY=sk-live-" + newToken + "\n"
	// Commit the secret so the agent's edit is a MODIFY of a TRACKED file — the git
	// substrate captures it, and its baseline (before) is real committed bytes.
	// (edit_file, not write_file: write_file to an existing path no-ops in the
	// deep-agent, producing no diff; the existing MODIFY test uses edit_file too.)
	harness.SeedWorkspaceFile(t, gitDir, path, baselineSecret)

	mockLLM, clients, waiter, mgr, execID := startFileReviewRunOpts(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			editFileTurn(0, "toolu_e_creds", path, oldToken, newToken),
			textTurn(1, "Updated the credentials file."),
		},
		"Update the API key in config/credentials.json using the filesystem tools.",
		false, // normal gate: the tracked edit flows via capture mode
	)

	// The tracked-secret write flows (no interrupt), so the turn completes and the
	// boundary opens a file review — never a tool approval.
	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("a tracked-secret edit should flow and open a file review: %v", err)
	}
	harness.AssertPendingApprovals(t, waiting, 0)

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the tracked-secret edit must surface an AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"a withheld tracked secret makes the set PARTIAL_BLOCKED")

	// Content-less MODIFY entry, labeled with its true provenance (GIT_TRACKED).
	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the tracked-secret path must be surfaced (path only) for review")
	assert.Equal(t, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_MODIFY, ch.GetKind(),
		"the honest kind is preserved (a MODIFY of the committed file)")
	assert.False(t, ch.GetDiffComplete(), "a withheld secret entry must be diff_complete=false")
	assert.Equal(t, agentexecv1.FileReviewBlockReason_FILE_REVIEW_BLOCK_REASON_SECRET_WITHHELD, ch.GetBlockedReason(),
		"the honest cause is recorded so the UI can say why")
	assert.Equal(t, agentexecv1.FileCaptureClass_FILE_CAPTURE_CLASS_GIT_TRACKED, ch.GetCaptureClass(),
		"a tracked secret is captured as GIT_TRACKED (its true provenance)")
	assert.Nil(t, ch.GetBefore(), "no before content: the baseline secret's bytes never enter the ledger")
	assert.Nil(t, ch.GetAfter(), "no after content: the new secret's bytes never enter the ledger")

	// Leak scan #1 (status): NEITHER the baseline (before) NOR the new (after)
	// secret token may appear anywhere in the persisted execution — not in the
	// ledger, and not in the edit's tool args (which the transcript scrub clears).
	// Before the fix the git diff carried both inline into the CANDIDATE change.
	statusJSON, err := protojson.Marshal(waiting)
	require.NoError(t, err, "marshal the persisted execution for the leak scan")
	assert.NotContains(t, string(statusJSON), oldToken,
		"the baseline secret token must never persist in the ledger/transcript")
	assert.NotContains(t, string(statusJSON), newToken,
		"the new secret token must never persist in the ledger/transcript")

	// Leak scan #2 (storage): neither secret token may reach any artifact file.
	artifactDir := mgr.LocalArtifactDir()
	require.NotEmpty(t, artifactDir, "the offline runner must have a local artifact dir")
	for _, needle := range [][]byte{[]byte(oldToken), []byte(newToken)} {
		walkErr := filepath.Walk(artifactDir, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			data, rerr := os.ReadFile(p)
			if rerr != nil {
				return rerr
			}
			assert.Falsef(t, bytes.Contains(data, needle),
				"secret bytes must never reach artifact storage; found in %s", p)
			return nil
		})
		require.NoError(t, walkErr, "scan the artifact dir for leaked secret bytes")
	}

	// APPROVE is refused (discard-only): a diff that was never reviewable cannot be
	// kept — the completeness gate, before the digest check, exactly as for a
	// gitignored secret.
	_, err = clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: execID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:   ch.GetFileDigest(),
	})
	require.Error(t, err, "approving an unreviewable tracked-secret entry must be refused")
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"an unreviewable-diff approval is a precondition failure")

	// REJECT (discard) reverts the working tree to the COMMITTED baseline
	// byte-exact — the tracked file is restored, NOT deleted (unlike a create).
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)
	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "discarding the unreviewable tracked-secret entry must complete the execution")
	assert.Equal(t, baselineSecret, harness.ReadWorkspaceFile(t, gitDir, path),
		"the discarded tracked-secret edit must revert to its committed baseline byte-exact")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review decision must NOT re-invoke the model")
}

// TestOffline_FileReview_SecretUnderGlobalBypass_NeverPersisted is the global-
// bypass safety lock (design doc 12, D4; DD-09 Option A). Under spec.auto_approve_all
// the approval gate is NOT installed, so a secret-like gitignored write is not
// hard-blocked up front — it executes and the .env lands on the user's own local
// disk (the accepted Option A trade-off: the gate is off by the user's opt-in).
// What must STILL hold is the durable-storage contract: the secret's CONTENT must
// never reach the persisted transcript (incl. tool-call args) or artifact storage.
// Two backstops enforce it — the turn-boundary secret re-check that withholds the
// path from CAS, and stampFileEditRow's defensive secret clear (the stamped row
// stays visible with its PATH, but its args/result/preview are withheld for a
// secret-like path; DD-12 D4) — and this test would FAIL before either was in
// place (the secret would ride along in args / a CAS blob).
func TestOffline_FileReview_SecretUnderGlobalBypass_NeverPersisted(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t) // seeds .gitignore with .env and .stigmer/
	const path = ".env"
	// A distinctive payload so a substring scan cannot false-positive on the path.
	const secret = "API_KEY=sk-live-SUPER-SECRET-DO-NOT-PERSIST-abc123xyz\n"

	mockLLM, clients, waiter, mgr, execID := startFileReviewRunOpts(t, ctx, gitDir,
		[]harness.RecordedLLMEntry{
			writeFileTurn(0, "toolu_w_env", path, secret),
			textTurn(1, "Wrote the env file."),
		},
		"Write the .env file using the filesystem tools.",
		true, // auto_approve_all -> global bypass -> no approval gate
	)

	// Fact under test #1: file review pauses even under the global bypass
	// (auto_approve_all bypasses TOOL gates, not file review).
	waiting, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, execID)
		t.Fatalf("a secret write under global bypass should still open a file review: %v", err)
	}
	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, waiting, 0) // never a tool approval

	set := harness.FindFileChangeSet(waiting, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)
	require.NotNil(t, set, "the secret write must surface an AWAITING_REVIEW change set")
	assert.Equal(t, agentexecv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, set.GetDiffCompleteness(),
		"the withheld secret makes the set PARTIAL_BLOCKED")

	ch := harness.FindCapturedChangeByPath(set, path)
	require.NotNil(t, ch, "the secret path must be surfaced (path only) for review")
	assert.False(t, ch.GetDiffComplete(), "a withheld secret entry must be diff_complete=false")
	assert.Equal(t, agentexecv1.FileCaptureClass_FILE_CAPTURE_CLASS_GIT_IGNORED_CAPTURED, ch.GetCaptureClass(),
		"a withheld gitignored secret is captured as GIT_IGNORED_CAPTURED")
	assert.Nil(t, ch.GetBefore(), "no before blob ref: the secret's bytes never reached CAS")
	assert.Nil(t, ch.GetAfter(), "no after blob ref: the secret's bytes never reached CAS")

	// The Option A trade-off, made explicit: under the global bypass the gate is
	// off, so the write DID reach the user's own local disk. This is accepted and
	// documented — the safety contract is about DURABLE PLATFORM storage, below.
	assert.True(t, harness.WorkspaceFileExists(t, gitDir, path),
		"under global bypass the gate is off, so the secret write reaches the user's local disk (accepted)")

	// Backstop #1 (transcript): the secret's CONTENT must appear NOWHERE in the
	// persisted status — most critically the flowed write row's tool-call args,
	// which hideToolCallRow now scrubs. A full marshal is the adversarial check.
	statusJSON, err := protojson.Marshal(waiting)
	require.NoError(t, err, "marshal the persisted execution for the leak scan")
	assert.NotContains(t, string(statusJSON), secret,
		"secret content must never persist in the transcript (tool-call args included)")

	// Backstop #2 (storage): the secret's bytes must be in NO artifact-store file.
	artifactDir := mgr.LocalArtifactDir()
	require.NotEmpty(t, artifactDir, "the offline runner must have a local artifact dir")
	secretBytes := []byte(secret)
	walkErr := filepath.Walk(artifactDir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		assert.Falsef(t, bytes.Contains(data, secretBytes),
			"secret bytes must never reach artifact storage; found in %s", p)
		return nil
	})
	require.NoError(t, walkErr, "scan the artifact dir for leaked secret bytes")

	// Liveness: the unreviewable secret can only be discarded; that completes the
	// execution with no model re-invocation.
	harness.SubmitFileDecisionByPath(t, ctx, clients, execID, set, path,
		agentexecv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT)
	_, err = waiter.WaitForPhase(ctx, execID, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "discarding the unreviewable secret entry must complete the execution")
	assert.Equal(t, 0, mockLLM.Remaining(), "a pure file-review decision must NOT re-invoke the model")
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

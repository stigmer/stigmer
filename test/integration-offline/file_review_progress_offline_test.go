//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Offline Mid-Run File-Change Progress Tests (DD-32 / DD-33) ---
//
// These prove the transient AgentExecutionStatus.file_change_progress field end
// to end through the real system (Cloud/Java service + TS runner): while a turn
// is IN FLIGHT, the runner attaches a content-free "N files changed so far"
// snapshot to the live status on every streaming persist; the server keeps it
// while its change set is CAPTURING and clears it at the turn boundary.
//
// Unlike the AWAITING_REVIEW file-review tests, these observe a NON-TERMINAL
// window, which is only deterministic because of three levers, all exercised
// here:
//
//  1. STIGMER_PROGRESS_CAPTURE_MIN_INTERVAL_MS=0 (progressCaptureFloorDisabled)
//     disables the 2s capture throttle, so EVERY streaming persist captures —
//     including the force-flushed persist the deep-agent emits right after each
//     write_file/edit_file completes. Scoped to this test's runner via the
//     harness ExtraEnv field, so the other file-review tests keep the default.
//  2. A held final turn (heldTextTurn, midRunHoldMs) keeps the execution
//     IN_PROGRESS — its change set still CAPTURING — long enough to observe. The
//     mock LLM holds the response open BEFORE streaming it, so the earlier
//     writes have already landed and been persisted; the server retains the
//     field (presence-guarded merge) for the whole hold.
//  3. WaitForFileChangeProgress polls for a SETTLED snapshot (a caller
//     predicate on files_changed), never merely a non-nil field — the first
//     persist fires before any write and legitimately carries files_changed=0.
//
// midRunHoldMs mirrors the lifecycle suite's keepAliveDelayMs and stays under
// the offline STIGMER_LLM_REQUEST_TIMEOUT_MS=5000, so the held request never
// times out.
const (
	progressCaptureFloorDisabled = "STIGMER_PROGRESS_CAPTURE_MIN_INTERVAL_MS=0"
	midRunHoldMs                 = 3000
)

// heldTextTurn is a text turn whose response the mock LLM holds open for delayMs
// before streaming it, keeping the execution IN_PROGRESS (its change set still
// CAPTURING) for that window so a poller can observe the transient progress.
func heldTextTurn(idx int, text string, delayMs int) harness.RecordedLLMEntry {
	e := textTurn(idx, text)
	e.Response.DelayMs = delayMs
	return e
}

// findProgressEntry returns the progress entry for the given workspace-relative
// path, matching either side (an ADD/MODIFY by its after-path, a DELETE by its
// before-path), or nil if absent.
func findProgressEntry(
	progress *agentexecv1.FileChangeProgress,
	path string,
) *agentexecv1.FileChangeProgressEntry {
	for _, e := range progress.GetEntries() {
		if e.GetPathAfter() == path || e.GetPathBefore() == path {
			return e
		}
	}
	return nil
}

// filesChangedIs returns a settled predicate for WaitForFileChangeProgress: the
// mid-run snapshot is accepted once it reports exactly n changed files. The
// field climbs 0 -> 1 -> ... -> n across the per-write persists and settles at n
// before the held turn, so this rejects the transient pre-write and mid-write
// snapshots and resolves deterministically inside the hold window.
func filesChangedIs(n int32) func(*agentexecv1.FileChangeProgress) bool {
	return func(p *agentexecv1.FileChangeProgress) bool {
		return p.GetFilesChanged() == n
	}
}

// TestOffline_FileReview_MidRunProgress_GitCapturedAndClearedAtBoundary is the
// headline mid-run guard (DD-32): while a turn edits git-tracked files, the live
// status carries a file_change_progress snapshot keyed to the CAPTURING set,
// with per-file kinds and numstat line counts; at the turn boundary the server
// clears it as the set becomes AWAITING_REVIEW.
func TestOffline_FileReview_MidRunProgress_GitCapturedAndClearedAtBoundary(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	// A committed tracked file so the turn produces a MODIFY (with real line
	// counts) alongside the CREATE.
	harness.SeedWorkspaceFile(t, gitDir, "existing.txt", "alpha\nbeta\n")

	const createdPath = "created.txt"
	const existingPath = "existing.txt"

	// write (ADD) -> edit (MODIFY) -> held text. Both file tools flow during the
	// turn; the edit's force-flushed persist attaches files_changed=2 with the
	// floor disabled, then the held text turn holds the CAPTURING window open.
	entries := []harness.RecordedLLMEntry{
		writeFileTurn(0, "toolu_w1", createdPath, "one\ntwo\nthree\n"),
		editFileTurn(1, "toolu_e1", existingPath, "beta", "BETA"),
		heldTextTurn(2, "Created and modified the files.", midRunHoldMs),
	}

	mockLLM, _, waiter, _, execID := startFileReviewRunOpts(t, ctx, gitDir, entries,
		"Create created.txt and modify existing.txt using the filesystem tools.",
		false, progressCaptureFloorDisabled)

	// --- Mid-run: the transient progress snapshot is observable and correct. ---
	midRun, err := waiter.WaitForFileChangeProgress(ctx, execID, 2*time.Minute, filesChangedIs(2))
	require.NoError(t, err, "a mid-run file_change_progress snapshot with 2 changed files must be observable during the held turn")

	capturing := harness.FindFileChangeSet(midRun, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING)
	require.NotNil(t, capturing, "the change set must still be CAPTURING while progress is live")

	progress := midRun.GetStatus().GetFileChangeProgress()
	require.NotNil(t, progress, "file_change_progress must be present mid-run")
	assert.Equal(t, capturing.GetId(), progress.GetChangeSetId(),
		"progress must be keyed to the CAPTURING set it previews")
	assert.EqualValues(t, 2, progress.GetFilesChanged(), "two files changed so far")

	created := findProgressEntry(progress, createdPath)
	require.NotNilf(t, created, "progress must include the created file %q", createdPath)
	assert.Equal(t, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD, created.GetKind(), "created.txt is an ADD")
	assert.EqualValues(t, 3, created.GetLinesAdded(), "created.txt added 3 lines")
	assert.EqualValues(t, 0, created.GetLinesRemoved(), "an ADD removes no lines")

	modified := findProgressEntry(progress, existingPath)
	require.NotNilf(t, modified, "progress must include the modified file %q", existingPath)
	assert.Equal(t, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_MODIFY, modified.GetKind(), "existing.txt is a MODIFY")
	assert.EqualValues(t, 1, modified.GetLinesAdded(), "the one-line edit adds one line")
	assert.EqualValues(t, 1, modified.GetLinesRemoved(), "the one-line edit removes one line")

	// The entry type carries only path/kind/line-counts — no bodies, no digests
	// (DD-32: progress is content-free). That is a structural guarantee of
	// FileChangeProgressEntry, so there is nothing to assert away here.

	// --- Boundary: the server clears progress as the set leaves CAPTURING. ---
	reviewed, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "the turn must reach AWAITING_REVIEW after the held turn completes")
	assert.Nil(t, reviewed.GetStatus().GetFileChangeProgress(),
		"file_change_progress must be cleared once its set leaves CAPTURING (the reconcile runs in the same status write that projects AWAITING_REVIEW)")

	assert.Equal(t, 0, mockLLM.Remaining(),
		"all scripted turns are consumed by the turn boundary; capturing progress must not re-invoke the model")
}

// TestOffline_FileReview_MidRunProgress_HybridGitignoredCaptured proves the
// DD-33 hybrid substrate mid-run: in a git workspace, a git-TRACKED write (the
// numstat slice) and a GITIGNORED write (the CAS-observer slice) both surface in
// one live file_change_progress snapshot, merged and disjoint. It mirrors
// TestOffline_FileReview_GitignoredCaptured_ReviewedAndReconciled's setup, but
// observes the transient pre-boundary window instead of the AWAITING_REVIEW set.
func TestOffline_FileReview_MidRunProgress_HybridGitignoredCaptured(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	gitDir := harness.NewGitWorkspace(t)
	harness.SeedGitignorePattern(t, gitDir, "cache/") // a non-secret ignored dir → CAS-captured

	const trackedPath = "tracked.txt"
	const ignoredPath = "cache/data.txt"

	// One tracked write (git numstat slice) + one gitignored write (CAS observer
	// slice; recordBefore populates the observer synchronously at write, so the
	// path is visible mid-run) + a held text turn to hold the CAPTURING window.
	entries := []harness.RecordedLLMEntry{
		writeFileTurn(0, "toolu_w_tracked", trackedPath, "tracked\n"),
		writeFileTurn(1, "toolu_w_ignored", ignoredPath, "cas\nbody\n"),
		heldTextTurn(2, "Wrote a tracked and an ignored file.", midRunHoldMs),
	}

	mockLLM, _, waiter, _, execID := startFileReviewRunOpts(t, ctx, gitDir, entries,
		"Write tracked.txt and cache/data.txt using the filesystem tools.",
		false, progressCaptureFloorDisabled)

	// --- Mid-run: both substrate slices merge into one progress snapshot. ---
	midRun, err := waiter.WaitForFileChangeProgress(ctx, execID, 2*time.Minute, filesChangedIs(2))
	require.NoError(t, err, "a mid-run snapshot merging the tracked + gitignored writes (2 files) must be observable")

	capturing := harness.FindFileChangeSet(midRun, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING)
	require.NotNil(t, capturing, "the change set must still be CAPTURING while progress is live")

	progress := midRun.GetStatus().GetFileChangeProgress()
	require.NotNil(t, progress, "file_change_progress must be present mid-run")
	assert.Equal(t, capturing.GetId(), progress.GetChangeSetId(),
		"progress must be keyed to the CAPTURING set it previews")
	assert.EqualValues(t, 2, progress.GetFilesChanged(),
		"the hybrid substrate merges the git and CAS slices into two disjoint files")

	tracked := findProgressEntry(progress, trackedPath)
	require.NotNilf(t, tracked, "the git-tracked write %q must appear (numstat slice)", trackedPath)
	assert.Equal(t, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD, tracked.GetKind(), "tracked.txt is an ADD")
	assert.EqualValues(t, 1, tracked.GetLinesAdded(), "tracked.txt added 1 line")

	ignored := findProgressEntry(progress, ignoredPath)
	require.NotNilf(t, ignored, "the gitignored write %q must appear (CAS observer slice)", ignoredPath)
	assert.Equal(t, agentexecv1.FileChangeKind_FILE_CHANGE_KIND_ADD, ignored.GetKind(), "cache/data.txt is an ADD")
	assert.EqualValues(t, 2, ignored.GetLinesAdded(), "cache/data.txt added 2 lines")

	// --- Boundary: progress clears once the set leaves CAPTURING. ---
	reviewed, err := waiter.WaitForFileReview(ctx, execID, 2*time.Minute)
	require.NoError(t, err, "the hybrid turn must reach AWAITING_REVIEW after the held turn completes")
	assert.Nil(t, reviewed.GetStatus().GetFileChangeProgress(),
		"file_change_progress must be cleared once its set leaves CAPTURING")

	assert.Equal(t, 0, mockLLM.Remaining(),
		"all scripted turns are consumed by the turn boundary; capturing progress must not re-invoke the model")
}

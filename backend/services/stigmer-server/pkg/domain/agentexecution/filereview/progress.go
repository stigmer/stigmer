package filereview

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ReconcileFileChangeProgress is the defense-in-depth clear for the transient
// AgentExecutionStatus.file_change_progress field (mid-run live capture, DD-32).
//
// Progress is a runner-owned, latest-snapshot DISPLAY field (the file-review
// analogue of setup_progress), NOT part of the append-only ledger. The runner
// overwrites it on each mid-run persist while its change set is CAPTURING; this
// seam clears it once that set leaves CAPTURING, so a stale mid-run delta never
// outlives the turn — exactly as setup_progress is cleared when the phase leaves
// PENDING (defense-in-depth: the presence-guarded merge cannot propagate a clear).
//
// It runs AFTER ProjectFileChangeSets so it reads the just-folded projection:
// progress is KEPT only while a CAPTURING change set with the matching
// change_set_id exists, else nil. A terminal execution is subsumed — the
// projection is empty there, so no CAPTURING set matches and progress clears.
// Keying on change_set_id (not merely "any CAPTURING set") is what makes resume
// correct: once a set is RECONCILED and the next turn pins a new baseline with a
// new change set id, a stale prior-turn progress no longer matches and clears.
func ReconcileFileChangeProgress(
	sets []*agentexecutionv1.FileChangeSet,
	progress *agentexecutionv1.FileChangeProgress,
) *agentexecutionv1.FileChangeProgress {
	if progress == nil {
		return nil
	}
	if hasCapturingSet(sets, progress.GetChangeSetId()) {
		return progress
	}
	return nil
}

// hasCapturingSet reports whether a change set with the given id is currently
// CAPTURING (baseline pinned, no candidate captured yet) in the just-computed
// projection.
func hasCapturingSet(sets []*agentexecutionv1.FileChangeSet, changeSetID string) bool {
	if changeSetID == "" {
		return false
	}
	for _, cs := range sets {
		if cs.GetId() == changeSetID &&
			cs.GetStatus() == agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING {
			return true
		}
	}
	return false
}

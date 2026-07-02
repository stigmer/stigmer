package filereview

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ProjectFileChangeSets is the single seam every status writer uses to recompute
// AgentExecutionStatus.file_change_sets from the append-only file_review ledger.
// It exists so the file-review projection has exactly one entry point per
// edition, exactly as ProjectPendingApprovals does for approvals.
//
// It is a PURE read — it never mutates the stream. Authoring the stream is the
// job of the capture/reconcile activities (Phase 2) and RecordFileDecisionEvent
// (author.go); callers run those before this projection so the passed stream is
// current.
//
// Unlike the approval seam, there is NO scan cross-check and NO divergence
// counter: file review is a greenfield, single-source ledger (there is no legacy
// second representation to disagree with, the way the approval message scan
// existed). The cross-edition parity guard is the shared corpus, not a
// per-edition counter.
//
// "Actionable" is execution-phase-aware: a terminal execution has no actionable
// review (the workflow that would reconcile is gone), so the seam returns nil
// for a terminal phase, mirroring ProjectPendingApprovals. The durable audit
// trail lives in the ledger (file_review_event_stream), which is always
// preserved regardless of phase.
func ProjectFileChangeSets(
	phase agentexecutionv1.ExecutionPhase,
	stream *agentexecutionv1.FileReviewEventStream,
) []*agentexecutionv1.FileChangeSet {
	if isTerminalExecution(phase) {
		return nil
	}
	if stream == nil || len(stream.GetEvents()) == 0 {
		return nil
	}

	order := make([]string, 0)
	byID := make(map[string]*agentexecutionv1.FileChangeSet)
	for _, ev := range stream.GetEvents() {
		csID := ev.GetChangeSetId()
		if csID == "" {
			continue
		}
		cs, ok := byID[csID]
		if !ok {
			cs = &agentexecutionv1.FileChangeSet{Id: csID}
			byID[csID] = cs
			order = append(order, csID)
		}
		applyEvent(cs, ev)
	}

	out := make([]*agentexecutionv1.FileChangeSet, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	return out
}

// applyEvent folds a single ledger event into the change set being built. Event
// order is the ledger order; terminal events (RECONCILED / FAILED) set a
// terminal status that later non-terminal recomputation does not override.
func applyEvent(cs *agentexecutionv1.FileChangeSet, ev *agentexecutionv1.FileReviewEvent) {
	switch ev.GetEventType() {
	case agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED:
		b := ev.GetBaselineCaptured()
		cs.TurnId = b.GetTurnId()
		cs.HarnessId = b.GetHarnessId()
		cs.BaselineSnapshot = b.GetBaselineSnapshot()
		cs.Status = agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING

	case agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED:
		c := ev.GetCandidateCaptured()
		cs.CandidateSnapshot = c.GetCandidateSnapshot()
		cs.Changes = c.GetChanges()
		cs.AggregateDigest = c.GetAggregateDigest()
		cs.DiffCompleteness = c.GetDiffCompleteness()
		cs.Status = deriveStatusAfterCandidate(cs)

	case agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED:
		if d := ev.GetFileDecided(); d != nil {
			cs.Decisions = append(cs.Decisions, d)
		}
		cs.Status = deriveStatusAfterCandidate(cs)

	case agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED:
		cs.ApprovedSnapshot = ev.GetReconciled().GetApprovedSnapshot()
		cs.Status = agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_RECONCILED

	case agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FAILED:
		cs.Status = agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_FAILED
	}
}

// deriveStatusAfterCandidate computes the non-terminal status once a candidate
// exists: DECIDED when every change is decided, otherwise AWAITING_REVIEW
// (partially-decided sets stay actionable). Never downgrades a terminal status.
func deriveStatusAfterCandidate(cs *agentexecutionv1.FileChangeSet) agentexecutionv1.FileChangeSetStatus {
	switch cs.GetStatus() {
	case agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_RECONCILED,
		agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_FAILED:
		return cs.GetStatus()
	}
	if isFullyDecided(cs) {
		return agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_DECIDED
	}
	return agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW
}

// isFullyDecided reports whether every change in the set has a verdict: either a
// CHANGE_SET-scoped decision (covers all), or a FILE decision for each change id.
func isFullyDecided(cs *agentexecutionv1.FileChangeSet) bool {
	if len(cs.GetChanges()) == 0 {
		return false
	}
	decidedFiles := make(map[string]struct{})
	for _, d := range cs.GetDecisions() {
		if d.GetScope() == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET {
			return true
		}
		if d.GetScope() == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
			decidedFiles[d.GetFileChangeId()] = struct{}{}
		}
	}
	for _, c := range cs.GetChanges() {
		if _, ok := decidedFiles[c.GetId()]; !ok {
			return false
		}
	}
	return true
}

// isTerminalExecution mirrors the approval package's terminal-phase set exactly,
// so the two projections collapse identically on a dead execution.
func isTerminalExecution(phase agentexecutionv1.ExecutionPhase) bool {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

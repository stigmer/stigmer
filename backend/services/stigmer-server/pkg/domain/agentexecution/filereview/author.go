package filereview

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

const actorUser = "user"

// EventID is the deterministic idempotency key for a file-review event:
// changeSetId:scopeId:eventType. Authoring is append-if-absent on this key, so
// re-deriving or retrying never duplicates an event (the Temporal-idempotency
// contract, identical in spirit to the approval stream's event_id).
func EventID(changeSetID, scopeID string, eventType agentexecutionv1.FileReviewEventType) string {
	return changeSetID + ":" + scopeID + ":" + eventType.String()
}

// decisionScopeID is the scope discriminator inside a decision's event id: the
// file change id for FILE scope, the change set id for CHANGE_SET scope. This
// lets a change set carry both one set-wide decision and per-file decisions
// without event-id collisions.
func decisionScopeID(d *agentexecutionv1.FileDecision) string {
	if d.GetScope() == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		return d.GetFileChangeId()
	}
	return d.GetChangeSetId()
}

// BuildFileDecision assembles a FileDecision from a validated SubmitFileDecision
// request plus server-supplied identity. The id is deterministic
// (changeSetId:scopeId) so a resubmit yields the same decision and the same
// event id — idempotent by construction.
func BuildFileDecision(
	changeSetID, fileChangeID string,
	scope agentexecutionv1.FileDecisionScope,
	action agentexecutionv1.FileDecisionAction,
	expectedDigest, reviewerID, decidedAt, reason string,
) *agentexecutionv1.FileDecision {
	decision := &agentexecutionv1.FileDecision{
		ChangeSetId:    changeSetID,
		FileChangeId:   fileChangeID,
		Scope:          scope,
		Action:         action,
		ExpectedDigest: expectedDigest,
		ReviewerId:     reviewerID,
		DecidedAt:      decidedAt,
		Reason:         reason,
	}
	decision.Id = changeSetID + ":" + decisionScopeID(decision)
	return decision
}

// RecordFileDecisionEvent authors a FILE_DECIDED event for the decision and
// appends it to the execution's file_review stream, idempotently by event id.
// This is the backend-owned writer (the runner authors capture/reconcile
// events). Run inside the store's write lock on a freshly-loaded stream so the
// append can never clobber a concurrent write.
func RecordFileDecisionEvent(
	status *agentexecutionv1.AgentExecutionStatus,
	executionID string,
	decision *agentexecutionv1.FileDecision,
) {
	if status == nil || decision == nil {
		return
	}
	stream := status.GetFileReviewEventStream()
	if stream == nil {
		stream = &agentexecutionv1.FileReviewEventStream{ExecutionId: executionID}
		status.FileReviewEventStream = stream
	}
	event := &agentexecutionv1.FileReviewEvent{
		EventId: EventID(
			decision.GetChangeSetId(),
			decisionScopeID(decision),
			agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED,
		),
		ChangeSetId: decision.GetChangeSetId(),
		EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED,
		Timestamp:   decision.GetDecidedAt(),
		Actor:       actorUser,
		Payload:     &agentexecutionv1.FileReviewEvent_FileDecided{FileDecided: decision},
	}
	if hasEvent(stream, event.GetEventId()) {
		return
	}
	stream.Events = append(stream.Events, event)
}

// AppendRunnerEvents folds the capture/reconcile events the runner authored on
// its UpdateStatus payload into the execution's server-owned file_review stream,
// append-only and idempotent by event_id. It is the file-review analogue of
// approval.EnsureApprovalRequests: the runner contributes events, the server
// owns the stream.
//
// Two invariants are enforced here, not merely documented:
//   - One writer per event type. FILE_DECIDED is authored exclusively by
//     SubmitFileDecision; a runner-sent FILE_DECIDED is dropped, so the runner
//     can never forge a human decision.
//   - Append-only. An event whose deterministic event_id already exists is
//     skipped, so a re-sent heartbeat or a Temporal retry never duplicates an
//     event (and can never overwrite one — existing events are immutable here).
//
// Must run inside the store write lock on the freshly-loaded stream so the
// appends cannot clobber a concurrent SubmitFileDecision.
func AppendRunnerEvents(
	status *agentexecutionv1.AgentExecutionStatus,
	executionID string,
	requestStatus *agentexecutionv1.AgentExecutionStatus,
) {
	if status == nil || requestStatus == nil {
		return
	}
	incoming := requestStatus.GetFileReviewEventStream().GetEvents()
	if len(incoming) == 0 {
		return
	}

	stream := status.GetFileReviewEventStream()
	if stream == nil {
		stream = &agentexecutionv1.FileReviewEventStream{ExecutionId: executionID}
		status.FileReviewEventStream = stream
	}

	for _, ev := range incoming {
		// Decisions are server-owned (SubmitFileDecision). Never accept one from
		// the runner — defense in depth against a forged human verdict.
		if ev.GetEventType() == agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED {
			continue
		}
		if ev.GetEventId() == "" || ev.GetChangeSetId() == "" {
			continue
		}
		if hasEvent(stream, ev.GetEventId()) {
			continue
		}
		stream.Events = append(stream.Events, ev)
	}
}

func hasEvent(stream *agentexecutionv1.FileReviewEventStream, eventID string) bool {
	for _, ev := range stream.GetEvents() {
		if ev.GetEventId() == eventID {
			return true
		}
	}
	return false
}

// FindChangeSet returns the projected change set with the given id, or nil.
func FindChangeSet(changeSets []*agentexecutionv1.FileChangeSet, changeSetID string) *agentexecutionv1.FileChangeSet {
	for _, cs := range changeSets {
		if cs.GetId() == changeSetID {
			return cs
		}
	}
	return nil
}

// FindChange returns the captured change with the given id within a set, or nil.
func FindChange(cs *agentexecutionv1.FileChangeSet, fileChangeID string) *agentexecutionv1.CapturedFileChange {
	for _, c := range cs.GetChanges() {
		if c.GetId() == fileChangeID {
			return c
		}
	}
	return nil
}

// TargetDigest is the digest a decision's expected_digest is checked against:
// the file's file_digest for FILE scope, the set's aggregate_digest for
// CHANGE_SET scope. Enforcement only — never used to correlate.
func TargetDigest(cs *agentexecutionv1.FileChangeSet, scope agentexecutionv1.FileDecisionScope, fileChangeID string) string {
	if scope == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		if c := FindChange(cs, fileChangeID); c != nil {
			return c.GetFileDigest()
		}
		return ""
	}
	return cs.GetAggregateDigest()
}

// ApproveBlockedReason returns why an APPROVE of the decision's target must be
// refused because its diff is not fully reviewable, or "" when the approve may
// proceed. It is the completeness sibling of TargetDigest: the second
// precondition SubmitFileDecision enforces before authoring a decision.
//
// The report rule (design docs 05 D3 / 11 D2): a non-COMPLETE diff can never be
// kept as if complete, so an unreviewable target is not approvable. The caller
// applies this to APPROVE only — REJECT is never gated, so an unreviewable change
// stays discardable and the turn can still resume (liveness). FILE scope turns
// on the one file's diff_complete; CHANGE_SET scope on the set's
// diff_completeness, so a complete file inside a PARTIAL_BLOCKED set is still
// approvable on its own. Fail-closed: an UNSPECIFIED completeness, an absent
// change, or a nil set are all treated as not approvable. Enforcement only,
// never a correlation key (mirrors TargetDigest's contract).
func ApproveBlockedReason(cs *agentexecutionv1.FileChangeSet, scope agentexecutionv1.FileDecisionScope, fileChangeID string) string {
	if cs == nil {
		return "change set is not reviewable"
	}
	if scope == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		c := FindChange(cs, fileChangeID)
		if c == nil {
			return "file change " + fileChangeID + " is not reviewable"
		}
		if !c.GetDiffComplete() {
			return "file change " + fileChangeID + " cannot be approved: its diff is not fully reviewable (incomplete or binary); reject it to discard, or wait for a complete capture"
		}
		return ""
	}
	if cs.GetDiffCompleteness() != agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE {
		return "change set " + cs.GetId() + " cannot be approved: at least one file's diff is not fully reviewable (incomplete or binary); reject the affected files or the whole set, or wait for a complete capture"
	}
	return ""
}

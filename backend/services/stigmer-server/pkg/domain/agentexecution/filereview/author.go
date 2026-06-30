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

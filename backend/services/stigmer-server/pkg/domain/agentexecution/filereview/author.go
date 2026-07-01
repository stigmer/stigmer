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
	acknowledgeUnreviewable bool,
) *agentexecutionv1.FileDecision {
	decision := &agentexecutionv1.FileDecision{
		ChangeSetId:             changeSetID,
		FileChangeId:            fileChangeID,
		Scope:                   scope,
		Action:                  action,
		ExpectedDigest:          expectedDigest,
		ReviewerId:              reviewerID,
		DecidedAt:               decidedAt,
		Reason:                  reason,
		AcknowledgeUnreviewable: acknowledgeUnreviewable,
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
//
// The binary-acknowledgment carve-out (DD-16 / DD-17): a BINARY file has no text
// diff to review, but its exact bytes are captured and byte-true reconcilable, so
// when the caller passes acknowledged==true the completeness gate is relaxed for
// binaries — the user consciously keeps them. At FILE scope this unblocks one
// binary file; at CHANGE_SET scope it unblocks a whole set whose every
// incompleteness is binary ("Keep all"). This is the ONLY relaxation: it is
// binary only (is_binary — never a secret-withheld / size-elided / uncapturable
// file, which have no keepable bytes and stay discard-only), and it never touches
// the expected_digest gate. The CHANGE_SET carve-out re-derives the "binary-only"
// condition from the actual changes (everyIncompleteChangeIsBinary), never from
// the diff_completeness rollup, so a stale or mislabeled rollup can never widen
// what may be kept.
func ApproveBlockedReason(cs *agentexecutionv1.FileChangeSet, scope agentexecutionv1.FileDecisionScope, fileChangeID string, acknowledged bool) string {
	if cs == nil {
		return "change set is not reviewable"
	}
	if scope == agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE {
		c := FindChange(cs, fileChangeID)
		if c == nil {
			return "file change " + fileChangeID + " is not reviewable"
		}
		if !c.GetDiffComplete() {
			// A binary file the user consciously acknowledged is keepable: no text
			// diff, but exact reconcilable bytes. Every other incompleteness has
			// no keepable bytes, so acknowledgment does not unblock it.
			if acknowledged && isBinaryChange(c) {
				return ""
			}
			return "file change " + fileChangeID + " cannot be approved: its diff is not fully reviewable (incomplete or binary); reject it to discard, or wait for a complete capture"
		}
		return ""
	}
	// CHANGE_SET scope: a COMPLETE set is approvable as-is. Otherwise the only
	// one-shot keep allowed is a set whose every incompleteness is binary, and
	// only when the user consciously acknowledged it ("Keep all", DD-17). Every
	// other non-COMPLETE set (a secret-withheld / size-elided / uncapturable file
	// is present) is resolved per file. Re-derived from the actual changes, never
	// the rollup, so a stale label cannot let a non-binary file ride along.
	if cs.GetDiffCompleteness() == agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE {
		return ""
	}
	if acknowledged && everyIncompleteChangeIsBinary(cs) {
		return ""
	}
	return "change set " + cs.GetId() + " cannot be approved: at least one file's diff is not fully reviewable (incomplete or binary); reject the affected files or the whole set, or wait for a complete capture"
}

// isBinaryChange reports whether either side of a captured change is binary —
// the single signal for "reviewable as bytes but not as a text diff" (DD-15 D2:
// binary is conveyed by FileContent.is_binary, never blocked_reason).
func isBinaryChange(c *agentexecutionv1.CapturedFileChange) bool {
	return c.GetBefore().GetIsBinary() || c.GetAfter().GetIsBinary()
}

// everyIncompleteChangeIsBinary reports whether the set has at least one
// incomplete change and every incomplete change is binary — the "keep-all is
// safe" condition (DD-17), mirroring the runner's BINARY_SUMMARY_ONLY rollup rule
// and the Java everyIncompleteChangeIsBinary. It is the enforcement boundary for
// a CHANGE_SET-scoped acknowledged approve: re-deriving from the changes means a
// secret-withheld / size-elided file (nil content -> not binary) always blocks
// the bulk keep, whatever the diff_completeness rollup claims.
func everyIncompleteChangeIsBinary(cs *agentexecutionv1.FileChangeSet) bool {
	sawIncomplete := false
	for _, c := range cs.GetChanges() {
		if c.GetDiffComplete() {
			continue
		}
		sawIncomplete = true
		if !isBinaryChange(c) {
			return false
		}
	}
	return sawIncomplete
}

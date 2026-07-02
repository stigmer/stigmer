package harness

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// File-review (apply-then-review FileChangeSet HITL) test helpers.
//
// These are the file-review siblings of the approval helpers in
// agent_execution_waiter.go / approval_stream.go. A git-backed harness (Cursor
// deny-only or the native deep-agent) lets edits FLOW during a turn and reviews
// the captured baseline->candidate diff at the turn boundary: the runner authors
// a FileChangeSet (status AWAITING_REVIEW), the human keeps/discards each file
// via SubmitFileDecision, and the runner reconciles the approved bytes on resume.
// All of these helpers read the SERVER projection (status.file_change_sets) and
// the append-only audit ledger (status.file_review_event_stream) — never any
// runner-internal state — so they hold identically for both harnesses and both
// editions.

// WaitForFileReview polls until the execution has at least one change set
// awaiting a human decision (status AWAITING_REVIEW), or times out. It is the
// file-review counterpart of WaitForApproval: a turn that edited tracked files
// reaches EXECUTION_WAITING_FOR_APPROVAL with the captured set projected onto
// status.file_change_sets. Returns the terminal snapshot together with an error
// if the execution finishes before any set is offered for review (e.g. the LLM
// did not edit a file, or every edit landed on a gitignored path that stays
// true-paused instead of being captured).
func (w *AgentExecutionWaiter) WaitForFileReview(ctx context.Context, executionID string, timeout time.Duration) (*agentexecv1.AgentExecution, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	for time.Now().Before(deadline) {
		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("agent execution poll error (will retry)", "execution_id", executionID, "error", err)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(interval):
			}
			interval = nextInterval(interval)
			continue
		}

		if FindFileChangeSet(exec, agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW) != nil {
			return exec, nil
		}

		if isAgentTerminalPhase(exec.GetStatus().GetPhase()) {
			return exec, fmt.Errorf(
				"agent execution %s reached terminal phase %s before any change set was offered for review",
				executionID, exec.GetStatus().GetPhase().String())
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
		interval = nextInterval(interval)
	}

	return nil, fmt.Errorf("timed out waiting for a file change set awaiting review on execution %s after %v",
		executionID, timeout)
}

// FindFileChangeSet returns the first projected change set in the given status,
// or nil if none match. Mirror of FindPendingApproval for the file-review
// projection (status.file_change_sets, recomputed from the file_review ledger on
// every status write).
func FindFileChangeSet(exec *agentexecv1.AgentExecution, status agentexecv1.FileChangeSetStatus) *agentexecv1.FileChangeSet {
	for _, cs := range exec.GetStatus().GetFileChangeSets() {
		if cs.GetStatus() == status {
			return cs
		}
	}
	return nil
}

// CountChangeSets returns how many projected change sets are in the given status.
func CountChangeSets(exec *agentexecv1.AgentExecution, status agentexecv1.FileChangeSetStatus) int {
	n := 0
	for _, cs := range exec.GetStatus().GetFileChangeSets() {
		if cs.GetStatus() == status {
			n++
		}
	}
	return n
}

// FindCapturedChangeByPath returns the captured change for the given
// workspace-relative path within a change set, or nil if none match. An
// ADD/MODIFY change is keyed by its after-path; a DELETE by its before-path
// (after-path is empty), so this matches either side.
func FindCapturedChangeByPath(set *agentexecv1.FileChangeSet, path string) *agentexecv1.CapturedFileChange {
	for _, ch := range set.GetChanges() {
		if ch.GetPathAfter() == path || ch.GetPathBefore() == path {
			return ch
		}
	}
	return nil
}

// AssertCapturedChange asserts that a change set carries a captured change for
// the given path with the expected kind, and returns it for further
// change-specific assertions (before/after content, sha256 digests, the
// file_digest the decision must echo as expected_digest). On absence it fails
// the test (non-fatally) and returns nil.
func AssertCapturedChange(
	t *testing.T,
	set *agentexecv1.FileChangeSet,
	path string,
	expectedKind agentexecv1.FileChangeKind,
) *agentexecv1.CapturedFileChange {
	t.Helper()
	ch := FindCapturedChangeByPath(set, path)
	if ch == nil {
		t.Errorf("expected a captured change for path %q in change set %q, found none (%d change(s) present)",
			path, set.GetId(), len(set.GetChanges()))
		return nil
	}
	assert.Equalf(t, expectedKind, ch.GetKind(),
		"captured change %q: expected kind %s, got %s",
		path, expectedKind.String(), ch.GetKind().String())
	assert.NotEmptyf(t, ch.GetFileDigest(),
		"captured change %q: file_digest must be populated (it is the expected_digest a FILE-scoped decision echoes)", path)
	return ch
}

// FileReviewStreamHasEvent reports whether the persisted, append-only
// file-review event stream contains an event of the given type for the given
// change set. It is the file-review sibling of ApprovalStreamHasEvent: the
// stream is the server-authored audit ledger that status.file_change_sets is
// projected from, so both suites assert against it through this one predicate.
func FileReviewStreamHasEvent(
	stream *agentexecv1.FileReviewEventStream,
	changeSetID string,
	eventType agentexecv1.FileReviewEventType,
) bool {
	for _, ev := range stream.GetEvents() {
		if ev.GetChangeSetId() == changeSetID && ev.GetEventType() == eventType {
			return true
		}
	}
	return false
}

// SubmitFileDecisionByPath records a FILE-scoped keep/discard decision on one
// captured change, looked up by its workspace-relative path. It resolves the
// required expected_digest from the projected change (the file_digest the
// reviewer saw), enforcing the "what you approve is what gets applied" contract
// the server re-checks. Fails the test fatally if the change is absent.
func SubmitFileDecisionByPath(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	executionID string,
	set *agentexecv1.FileChangeSet,
	path string,
	action agentexecv1.FileDecisionAction,
) {
	t.Helper()
	ch := FindCapturedChangeByPath(set, path)
	require.NotNilf(t, ch, "cannot decide path %q: no captured change in set %q", path, set.GetId())

	_, err := clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: executionID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		FileChangeId:     ch.GetId(),
		Action:           action,
		ExpectedDigest:   ch.GetFileDigest(),
	})
	require.NoErrorf(t, err, "submit FILE decision (%s) for %q in set %q", action.String(), path, set.GetId())
}

// SubmitChangeSetDecision records one CHANGE_SET-scoped decision that covers
// every change in the set in a single call (the "Keep all" / "Discard all"
// action). It echoes the set's aggregate_digest as expected_digest.
func SubmitChangeSetDecision(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	executionID string,
	set *agentexecv1.FileChangeSet,
	action agentexecv1.FileDecisionAction,
) {
	t.Helper()
	_, err := clients.AgentExecutionCommand.SubmitFileDecision(ctx, &agentexecv1.SubmitFileDecisionInput{
		AgentExecutionId: executionID,
		ChangeSetId:      set.GetId(),
		Scope:            agentexecv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:           action,
		ExpectedDigest:   set.GetAggregateDigest(),
	})
	require.NoErrorf(t, err, "submit CHANGE_SET decision (%s) for set %q", action.String(), set.GetId())
}

// ResolveFileDecisionsByPathUntilPhase steps an execution through file review by
// deciding every captured change with a per-path callback, until the execution
// reaches target or times out. It is the file-review counterpart of
// ResolveApprovalsByPathUntilPhase.
//
// Unlike tool approvals, ordering does NOT matter here: SubmitFileDecision only
// signals the workflow to resume once the WHOLE gate clears (no change set
// awaiting review AND no pending approval — see submit_file_decision.go
// GateResolved). A file REJECT has no immediate-resume shortcut, so every change
// in the set must be decided before the runner reconciles. This submits a
// FILE-scoped decision for each change in each AWAITING_REVIEW set, then waits
// for the resume to drive the execution to target.
//
// decideByPath receives each captured change's path (after-path, or before-path
// for a delete) and returns APPROVE (keep) or REJECT (discard). Decided changes
// move the set out of AWAITING_REVIEW, so re-polling never re-submits.
func (w *AgentExecutionWaiter) ResolveFileDecisionsByPathUntilPhase(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	executionID string,
	decideByPath func(path string) agentexecv1.FileDecisionAction,
	target agentexecv1.ExecutionPhase,
	timeout time.Duration,
) (*agentexecv1.AgentExecution, error) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	interval := 500 * time.Millisecond

	for time.Now().Before(deadline) {
		exec, err := w.client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			return nil, fmt.Errorf("get execution %s: %w", executionID, err)
		}

		phase := exec.GetStatus().GetPhase()
		if phase == target {
			return exec, nil
		}

		for _, set := range exec.GetStatus().GetFileChangeSets() {
			if set.GetStatus() != agentexecv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW {
				continue
			}
			for _, ch := range set.GetChanges() {
				path := ch.GetPathAfter()
				if path == "" {
					path = ch.GetPathBefore()
				}
				SubmitFileDecisionByPath(t, ctx, clients, executionID, set, path, decideByPath(path))
			}
		}

		if isAgentTerminalPhase(phase) && phase != target {
			return exec, fmt.Errorf(
				"agent execution reached terminal phase %s instead of expected %s",
				phase.String(), target.String(),
			)
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
	}

	return nil, fmt.Errorf(
		"timed out waiting for agent execution %s to reach phase %s after %v",
		executionID, target.String(), timeout,
	)
}

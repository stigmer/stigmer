package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func TestBuildFileDecisionDeterministicID(t *testing.T) {
	fileScoped := BuildFileDecision("cs1", "fc1",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "", false)
	if fileScoped.GetId() != "cs1:fc1" {
		t.Errorf("FILE-scope decision id = %q, want %q", fileScoped.GetId(), "cs1:fc1")
	}

	setScoped := BuildFileDecision("cs1", "",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "", false)
	if setScoped.GetId() != "cs1:cs1" {
		t.Errorf("CHANGE_SET-scope decision id = %q, want %q", setScoped.GetId(), "cs1:cs1")
	}

	// The acknowledgment flag is carried onto the persisted decision (audit).
	acked := BuildFileDecision("cs1", "fc-bin",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "", true)
	if !acked.GetAcknowledgeUnreviewable() {
		t.Error("acknowledge_unreviewable should be recorded on the decision")
	}
}

func TestRecordFileDecisionEventIdempotent(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	decision := BuildFileDecision("cs1", "fc1",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "looks good", false)

	RecordFileDecisionEvent(status, "aex_1", decision)
	RecordFileDecisionEvent(status, "aex_1", decision) // re-author must be a no-op

	events := status.GetFileReviewEventStream().GetEvents()
	if len(events) != 1 {
		t.Fatalf("re-authoring the same decision produced %d events, want 1 (append-if-absent)", len(events))
	}
	if got := events[0].GetEventType(); got != agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED {
		t.Errorf("event type = %v, want FILE_DECIDED", got)
	}
	if got := status.GetFileReviewEventStream().GetExecutionId(); got != "aex_1" {
		t.Errorf("stream execution_id = %q, want %q", got, "aex_1")
	}
}

func TestProjectFileChangeSetsTerminalReturnsNil(t *testing.T) {
	stream := &agentexecutionv1.FileReviewEventStream{
		Events: []*agentexecutionv1.FileReviewEvent{{
			EventId:     "cs1::FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED",
			ChangeSetId: "cs1",
			EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED,
			Payload: &agentexecutionv1.FileReviewEvent_BaselineCaptured{
				BaselineCaptured: &agentexecutionv1.FileReviewBaselineCaptured{ChangeSetId: "cs1"},
			},
		}},
	}
	if got := ProjectFileChangeSets(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, stream); got != nil {
		t.Errorf("terminal execution projected %d change sets, want nil", len(got))
	}
}

func TestTargetDigestSelectsByScope(t *testing.T) {
	cs := &agentexecutionv1.FileChangeSet{
		AggregateDigest: "agg",
		Changes: []*agentexecutionv1.CapturedFileChange{
			{Id: "fc1", FileDigest: "d-fc1"},
		},
	}
	if got := TargetDigest(cs, agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET, ""); got != "agg" {
		t.Errorf("CHANGE_SET target digest = %q, want %q", got, "agg")
	}
	if got := TargetDigest(cs, agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE, "fc1"); got != "d-fc1" {
		t.Errorf("FILE target digest = %q, want %q", got, "d-fc1")
	}
}

// TestApproveBlockedReason locks the completeness precondition in lockstep with
// the Java FileReviewStreamAuthorTest table: an APPROVE of an unreviewable target
// is refused; a complete target (even inside a PARTIAL_BLOCKED set, via FILE
// scope) is allowed; UNSPECIFIED/absent/nil are fail-closed. The acknowledgment
// carve-out unblocks a binary FILE (DD-16) and a binary-only CHANGE_SET
// ("Keep all", DD-17) — but never a set holding a non-binary incomplete file,
// because the CHANGE_SET gate re-derives "binary-only" from the actual changes.
func TestApproveBlockedReason(t *testing.T) {
	const (
		fileScope = agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE
		setScope  = agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET
	)
	// A set mixing a reviewable file, a non-binary incomplete file (e.g. secret-
	// withheld / size-elided — no keepable bytes), and a binary file (no text
	// diff, but exact reconcilable bytes) — the per-target + acknowledgment cases.
	setWith := func(completeness agentexecutionv1.DiffCompleteness) *agentexecutionv1.FileChangeSet {
		return &agentexecutionv1.FileChangeSet{
			Id:               "cs1",
			DiffCompleteness: completeness,
			Changes: []*agentexecutionv1.CapturedFileChange{
				{Id: "fc-complete", DiffComplete: true},
				{Id: "fc-incomplete", DiffComplete: false},
				{Id: "fc-binary", DiffComplete: false, After: &agentexecutionv1.FileContent{IsBinary: true}},
			},
		}
	}

	// A binary-only set (DD-17): a reviewable file plus a binary — the set's only
	// incompleteness is binary, so an acknowledged CHANGE_SET approve keeps it all.
	binaryOnlySet := func() *agentexecutionv1.FileChangeSet {
		return &agentexecutionv1.FileChangeSet{
			Id:               "cs1",
			DiffCompleteness: agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY,
			Changes: []*agentexecutionv1.CapturedFileChange{
				{Id: "fc-complete", DiffComplete: true},
				{Id: "fc-binary", DiffComplete: false, After: &agentexecutionv1.FileContent{IsBinary: true}},
			},
		}
	}

	cases := []struct {
		name         string
		cs           *agentexecutionv1.FileChangeSet
		scope        agentexecutionv1.FileDecisionScope
		fileID       string
		acknowledged bool
		wantBlocked  bool
	}{
		{"nil set is fail-closed", nil, setScope, "", false, true},
		{"FILE scope, complete file in partial set is approvable", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), fileScope, "fc-complete", false, false},
		{"FILE scope, incomplete file is blocked", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), fileScope, "fc-incomplete", false, true},
		{"FILE scope, absent file is fail-closed", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE), fileScope, "nope", false, true},
		{"CHANGE_SET scope, COMPLETE is approvable", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE), setScope, "", false, false},
		{"CHANGE_SET scope, PARTIAL_BLOCKED without ack is blocked", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), setScope, "", false, true},
		{"CHANGE_SET scope, BINARY_SUMMARY_ONLY without ack is blocked", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY), setScope, "", false, true},
		{"CHANGE_SET scope, UNSPECIFIED is fail-closed", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_UNSPECIFIED), setScope, "", false, true},

		// Binary-acknowledgment carve-out (DD-16): FILE scope, binary only.
		{"FILE scope, binary file without ack is blocked", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), fileScope, "fc-binary", false, true},
		{"FILE scope, binary file WITH ack is approvable", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), fileScope, "fc-binary", true, false},
		{"FILE scope, ack does NOT unblock a non-binary incomplete file", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), fileScope, "fc-incomplete", true, true},

		// Set-level keep-all carve-out (DD-17): CHANGE_SET scope, binary-only set.
		{"CHANGE_SET scope, ack keeps a binary-only set (keep-all)", binaryOnlySet(), setScope, "", true, false},
		{"CHANGE_SET scope, ack does NOT keep a set with a non-binary incomplete file", setWith(agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED), setScope, "", true, true},
		{"CHANGE_SET scope, keep-all re-derives per file: a mislabeled COMPLETE-but-binary-only set still needs ack", binaryOnlySet(), setScope, "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason := ApproveBlockedReason(tc.cs, tc.scope, tc.fileID, tc.acknowledged)
			if blocked := reason != ""; blocked != tc.wantBlocked {
				t.Errorf("ApproveBlockedReason = %q (blocked=%v), want blocked=%v", reason, blocked, tc.wantBlocked)
			}
		})
	}
}

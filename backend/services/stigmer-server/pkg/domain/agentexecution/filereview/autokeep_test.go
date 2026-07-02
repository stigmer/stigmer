package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// Test fixtures: a one-file, fully-reviewable candidate whose provenance cites
// one consent row — the forensic big.txt shape (aex_01kwj07f7g23c3wp9sn8496z5g).

const (
	autoKeepChangeSet = "exec-1:1"
	consentRowID      = "gate-row-1"
)

func candidateWithProvenance(provenance *agentexecutionv1.TurnCommandProvenance) *agentexecutionv1.FileReviewEvent {
	return &agentexecutionv1.FileReviewEvent{
		EventId:     EventID(autoKeepChangeSet, autoKeepChangeSet, agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED),
		ChangeSetId: autoKeepChangeSet,
		EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED,
		Payload: &agentexecutionv1.FileReviewEvent_CandidateCaptured{
			CandidateCaptured: &agentexecutionv1.FileReviewCandidateCaptured{
				ChangeSetId: autoKeepChangeSet,
				Changes: []*agentexecutionv1.CapturedFileChange{{
					Id:           autoKeepChangeSet + ":big.txt",
					PathAfter:    "big.txt",
					Kind:         agentexecutionv1.FileChangeKind_FILE_CHANGE_KIND_ADD,
					DiffComplete: true,
					FileDigest:   "file-digest",
				}},
				AggregateDigest:   "aggregate-digest",
				DiffCompleteness:  agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE,
				CommandProvenance: provenance,
			},
		},
	}
}

func consentedShellProvenance() *agentexecutionv1.TurnCommandProvenance {
	return &agentexecutionv1.TurnCommandProvenance{ConsentToolCallIds: []string{consentRowID}}
}

// statusWithCandidate builds a status holding the candidate event plus a
// transcript row for the consent lookup, with the given approval action.
func statusWithCandidate(provenance *agentexecutionv1.TurnCommandProvenance, consentAction agentexecutionv1.ApprovalAction) *agentexecutionv1.AgentExecutionStatus {
	return &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		FileReviewEventStream: &agentexecutionv1.FileReviewEventStream{
			ExecutionId: "exec-1",
			Events:      []*agentexecutionv1.FileReviewEvent{candidateWithProvenance(provenance)},
		},
		Messages: []*agentexecutionv1.AgentMessage{{
			Type: agentexecutionv1.MessageType_MESSAGE_AI,
			ToolCalls: []*agentexecutionv1.ToolCall{{
				Id:             consentRowID,
				Name:           "shell",
				Status:         agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
				ApprovalAction: consentAction,
			}},
		}},
	}
}

func decisionEvents(status *agentexecutionv1.AgentExecutionStatus) []*agentexecutionv1.FileReviewEvent {
	var out []*agentexecutionv1.FileReviewEvent
	for _, ev := range status.GetFileReviewEventStream().GetEvents() {
		if ev.GetEventType() == agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED {
			out = append(out, ev)
		}
	}
	return out
}

func TestAutoKeep_ApprovedCommandAuthorsPolicyDecision(t *testing.T) {
	status := statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE)

	kept := AutoKeepApprovedCommandSets(status, "exec-1", false)

	if kept != 1 {
		t.Fatalf("expected 1 auto-kept set, got %d", kept)
	}
	decisions := decisionEvents(status)
	if len(decisions) != 1 {
		t.Fatalf("expected 1 FILE_DECIDED event, got %d", len(decisions))
	}
	ev := decisions[0]
	if ev.GetActor() != actorPolicy {
		t.Errorf("actor = %q, want %q", ev.GetActor(), actorPolicy)
	}
	d := ev.GetFileDecided()
	if d.GetOrigin() != agentexecutionv1.FileDecisionOrigin_FILE_DECISION_ORIGIN_POLICY_APPROVED_COMMAND {
		t.Errorf("origin = %v, want POLICY_APPROVED_COMMAND", d.GetOrigin())
	}
	if d.GetScope() != agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET {
		t.Errorf("scope = %v, want CHANGE_SET", d.GetScope())
	}
	if d.GetAction() != agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE {
		t.Errorf("action = %v, want APPROVE", d.GetAction())
	}
	if d.GetExpectedDigest() != "aggregate-digest" {
		t.Errorf("expected_digest = %q, want the reviewed aggregate digest", d.GetExpectedDigest())
	}
	if d.GetReviewerId() != "" {
		t.Errorf("a policy decision must not carry a reviewer id, got %q", d.GetReviewerId())
	}

	// The projection now derives DECIDED — the gate never arms.
	sets := ProjectFileChangeSets(status.GetPhase(), status.GetFileReviewEventStream())
	if got := FindChangeSet(sets, autoKeepChangeSet).GetStatus(); got != agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_DECIDED {
		t.Errorf("projected status = %v, want DECIDED", got)
	}
	if !HasDecidedAwaitingReconcile(&agentexecutionv1.AgentExecutionStatus{FileChangeSets: sets}) {
		t.Errorf("HasDecidedAwaitingReconcile must be true for the auto-kept set")
	}
}

func TestAutoKeep_ApproveAllLeaseRowIsValidConsent(t *testing.T) {
	status := statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL)
	if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 1 {
		t.Fatalf("APPROVE_ALL consent row must verify, got kept=%d", kept)
	}
}

func TestAutoKeep_UnverifiedConsentFailsClosed(t *testing.T) {
	cases := map[string]*agentexecutionv1.AgentExecutionStatus{
		// The cited row exists but the human never approved it.
		"undecided consent row": statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
		// The human REJECTED the cited row.
		"rejected consent row": statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT),
		// The cited row does not exist at all.
		"missing consent row": statusWithCandidate(
			&agentexecutionv1.TurnCommandProvenance{ConsentToolCallIds: []string{"no-such-row"}},
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		),
		// Empty claim: no consent ids, no auto flag — authorizes nothing.
		"empty claim": statusWithCandidate(&agentexecutionv1.TurnCommandProvenance{}, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE),
	}
	for name, status := range cases {
		if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 0 {
			t.Errorf("%s: expected fail-closed (0 kept), got %d", name, kept)
		}
		if len(decisionEvents(status)) != 0 {
			t.Errorf("%s: no decision must be authored", name)
		}
	}
}

func TestAutoKeep_AutoApproveAllClaimVerifiedAgainstSpec(t *testing.T) {
	provenance := &agentexecutionv1.TurnCommandProvenance{AuthorizedByAutoApproveAll: true}

	// Claim without the spec flag → forged bypass, fail closed.
	status := statusWithCandidate(provenance, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 0 {
		t.Fatalf("auto_approve_all claim without the spec flag must fail closed, got kept=%d", kept)
	}

	// Claim matching the spec flag → verified.
	status = statusWithCandidate(provenance, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	if kept := AutoKeepApprovedCommandSets(status, "exec-1", true); kept != 1 {
		t.Fatalf("auto_approve_all claim matching the spec must verify, got kept=%d", kept)
	}
}

func TestAutoKeep_UnreviewableSetFallsBackToManualReview(t *testing.T) {
	status := statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE)
	// Make the single change unreviewable — the completeness gate must refuse.
	candidate := status.GetFileReviewEventStream().GetEvents()[0].GetCandidateCaptured()
	candidate.Changes[0].DiffComplete = false
	candidate.DiffCompleteness = agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED

	if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 0 {
		t.Fatalf("an unreviewable set must never be auto-kept, got kept=%d", kept)
	}
}

func TestAutoKeep_HumanDecisionWins(t *testing.T) {
	status := statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE)
	// A human FILE-scoped decision landed first — the human owns the set.
	human := BuildFileDecision(autoKeepChangeSet, autoKeepChangeSet+":big.txt",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT,
		"file-digest", "reviewer-1", "now", "", false)
	RecordFileDecisionEvent(status, "exec-1", human)

	if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 0 {
		t.Fatalf("a set with any human decision must never be auto-kept, got kept=%d", kept)
	}
}

func TestAutoKeep_IdempotentAcrossStatusWrites(t *testing.T) {
	status := statusWithCandidate(consentedShellProvenance(), agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE)

	first := AutoKeepApprovedCommandSets(status, "exec-1", false)
	second := AutoKeepApprovedCommandSets(status, "exec-1", false)

	if first != 1 || second != 0 {
		t.Fatalf("expected exactly one keep across re-evaluations, got first=%d second=%d", first, second)
	}
	if n := len(decisionEvents(status)); n != 1 {
		t.Fatalf("expected exactly 1 FILE_DECIDED event, got %d", n)
	}
}

func TestAutoKeep_NoProvenanceIsUntouched(t *testing.T) {
	status := statusWithCandidate(nil, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE)
	if kept := AutoKeepApprovedCommandSets(status, "exec-1", false); kept != 0 {
		t.Fatalf("a candidate without provenance must review manually, got kept=%d", kept)
	}
}

func TestAutoKeep_UserDecisionCarriesUserOrigin(t *testing.T) {
	d := BuildFileDecision("cs-1", "", agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE, "digest", "reviewer-1", "now", "", false)
	if d.GetOrigin() != agentexecutionv1.FileDecisionOrigin_FILE_DECISION_ORIGIN_USER {
		t.Errorf("BuildFileDecision origin = %v, want USER", d.GetOrigin())
	}
}

package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func runnerEvent(changeSetID string, t agentexecutionv1.FileReviewEventType) *agentexecutionv1.FileReviewEvent {
	return &agentexecutionv1.FileReviewEvent{
		EventId:     EventID(changeSetID, changeSetID, t),
		ChangeSetId: changeSetID,
		EventType:   t,
	}
}

func reqWith(events ...*agentexecutionv1.FileReviewEvent) *agentexecutionv1.AgentExecutionStatus {
	return &agentexecutionv1.AgentExecutionStatus{
		FileReviewEventStream: &agentexecutionv1.FileReviewEventStream{Events: events},
	}
}

func TestAppendRunnerEvents_FoldsIntoEmptyStream(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	req := reqWith(
		runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED),
		runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED),
	)

	AppendRunnerEvents(status, "exec-1", req)

	got := status.GetFileReviewEventStream().GetEvents()
	if len(got) != 2 {
		t.Fatalf("expected 2 events folded, got %d", len(got))
	}
	if status.GetFileReviewEventStream().GetExecutionId() != "exec-1" {
		t.Errorf("stream seeded with wrong execution id: %q", status.GetFileReviewEventStream().GetExecutionId())
	}
}

func TestAppendRunnerEvents_IdempotentByEventID(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	baseline := runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED)

	// Fold twice (a re-sent heartbeat / activity retry).
	AppendRunnerEvents(status, "exec-1", reqWith(baseline))
	AppendRunnerEvents(status, "exec-1", reqWith(baseline))

	if n := len(status.GetFileReviewEventStream().GetEvents()); n != 1 {
		t.Fatalf("expected 1 event after duplicate fold, got %d", n)
	}
}

func TestAppendRunnerEvents_DropsRunnerSentFileDecided(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	forged := runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED)
	legit := runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_RECONCILED)

	AppendRunnerEvents(status, "exec-1", reqWith(forged, legit))

	got := status.GetFileReviewEventStream().GetEvents()
	if len(got) != 1 {
		t.Fatalf("expected only the non-decision event, got %d", len(got))
	}
	if got[0].GetEventType() == agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED {
		t.Errorf("runner-sent FILE_DECIDED must be dropped")
	}
}

func TestAppendRunnerEvents_NeverClobbersExistingDecision(t *testing.T) {
	// A decision authored by SubmitFileDecision is already on the stream.
	decision := BuildFileDecision("cs-1", "", agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE, "digest", "", "now", "", false)
	status := &agentexecutionv1.AgentExecutionStatus{}
	RecordFileDecisionEvent(status, "exec-1", decision)
	before := len(status.GetFileReviewEventStream().GetEvents())

	// The runner re-sends a candidate; the decision must survive untouched.
	AppendRunnerEvents(status, "exec-1", reqWith(
		runnerEvent("cs-1", agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED),
	))

	events := status.GetFileReviewEventStream().GetEvents()
	if len(events) != before+1 {
		t.Fatalf("expected exactly one new event appended, got %d (was %d)", len(events), before)
	}
	foundDecision := false
	for _, ev := range events {
		if ev.GetEventType() == agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_FILE_DECIDED {
			foundDecision = true
		}
	}
	if !foundDecision {
		t.Errorf("the prior FILE_DECIDED event was lost")
	}
}

func TestAppendRunnerEvents_SkipsMalformed(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	AppendRunnerEvents(status, "exec-1", reqWith(
		&agentexecutionv1.FileReviewEvent{EventId: "", ChangeSetId: "cs-1", EventType: agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED},
		&agentexecutionv1.FileReviewEvent{EventId: "x", ChangeSetId: "", EventType: agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED},
	))
	if n := len(status.GetFileReviewEventStream().GetEvents()); n != 0 {
		t.Fatalf("malformed events should be skipped, got %d", n)
	}
}

func TestAppendRunnerEvents_NilRequestSafe(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	AppendRunnerEvents(status, "exec-1", nil)
	if status.GetFileReviewEventStream() != nil {
		t.Errorf("nil request must not seed a stream")
	}
}

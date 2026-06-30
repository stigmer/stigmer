package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func TestBuildFileDecisionDeterministicID(t *testing.T) {
	fileScoped := BuildFileDecision("cs1", "fc1",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "")
	if fileScoped.GetId() != "cs1:fc1" {
		t.Errorf("FILE-scope decision id = %q, want %q", fileScoped.GetId(), "cs1:fc1")
	}

	setScoped := BuildFileDecision("cs1", "",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "")
	if setScoped.GetId() != "cs1:cs1" {
		t.Errorf("CHANGE_SET-scope decision id = %q, want %q", setScoped.GetId(), "cs1:cs1")
	}
}

func TestRecordFileDecisionEventIdempotent(t *testing.T) {
	status := &agentexecutionv1.AgentExecutionStatus{}
	decision := BuildFileDecision("cs1", "fc1",
		agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE,
		agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		"digest", "u1", "2026-06-30T00:00:00Z", "looks good")

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

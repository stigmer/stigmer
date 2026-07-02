package activities

import (
	"encoding/json"
	"testing"
)

// TestExecuteCursorActivityInput_WireShape locks the JSON keys of the Cursor
// activity input to the snake_case wire contract shared with the Java record
// (ExecuteCursorActivityInput, @JsonNaming snake_case) and the TypeScript
// runner's normalized input. A drift here silently breaks the polyglot Temporal
// activity boundary (the runner would read empty execution_id/thread_id).
func TestExecuteCursorActivityInput_WireShape(t *testing.T) {
	b, err := json.Marshal(ExecuteCursorActivityInput{
		ExecutionID:              "exec-1",
		ThreadID:                 "thread-1",
		InvokerIdentityAccountID: "acct-1",
		TurnSeq:                  3,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	want := `{"execution_id":"exec-1","thread_id":"thread-1","invoker_identity_account_id":"acct-1","turn_seq":3}`
	if got != want {
		t.Fatalf("ExecuteCursorActivityInput JSON mismatch:\n got=%s\nwant=%s", got, want)
	}
}

// TestExecuteDeepAgentActivityInput_WireShape locks the deep-agent activity
// input keys to the same snake_case wire contract.
func TestExecuteDeepAgentActivityInput_WireShape(t *testing.T) {
	b, err := json.Marshal(ExecuteDeepAgentActivityInput{
		ExecutionID:              "exec-2",
		ThreadID:                 "thread-2",
		InvokerIdentityAccountID: "acct-2",
		TurnSeq:                  5,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	want := `{"execution_id":"exec-2","thread_id":"thread-2","invoker_identity_account_id":"acct-2","turn_seq":5}`
	if got != want {
		t.Fatalf("ExecuteDeepAgentActivityInput JSON mismatch:\n got=%s\nwant=%s", got, want)
	}
}

// TestExecuteCursorActivityInput_DefaultTurnSeq locks the first-invocation wire
// shape: an unset TurnSeq serializes as turn_seq:0 (the workflow passes 0 on the
// initial call), so the runner reads a defined 0 rather than a missing key.
func TestExecuteCursorActivityInput_DefaultTurnSeq(t *testing.T) {
	b, err := json.Marshal(ExecuteCursorActivityInput{
		ExecutionID:              "exec-1",
		ThreadID:                 "",
		InvokerIdentityAccountID: "acct-1",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	want := `{"execution_id":"exec-1","thread_id":"","invoker_identity_account_id":"acct-1","turn_seq":0}`
	if got != want {
		t.Fatalf("ExecuteCursorActivityInput default turn_seq mismatch:\n got=%s\nwant=%s", got, want)
	}
}

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
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	want := `{"execution_id":"exec-1","thread_id":"thread-1","invoker_identity_account_id":"acct-1"}`
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
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	want := `{"execution_id":"exec-2","thread_id":"thread-2","invoker_identity_account_id":"acct-2"}`
	if got != want {
		t.Fatalf("ExecuteDeepAgentActivityInput JSON mismatch:\n got=%s\nwant=%s", got, want)
	}
}

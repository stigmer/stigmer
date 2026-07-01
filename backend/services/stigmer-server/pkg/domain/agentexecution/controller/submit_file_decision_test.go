package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fileReviewExecution builds a non-terminal execution whose ledger projects to a
// single change set "cs1" with the given completeness and changes — the minimal
// input validateFileDecisionTarget needs to exercise the completeness gate.
func fileReviewExecution(
	completeness agentexecutionv1.DiffCompleteness,
	changes ...*agentexecutionv1.CapturedFileChange,
) *agentexecutionv1.AgentExecution {
	const csID = "cs1"
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			FileReviewEventStream: &agentexecutionv1.FileReviewEventStream{
				ExecutionId: "aex_test",
				Events: []*agentexecutionv1.FileReviewEvent{
					{
						EventId:     csID + ":" + csID + ":FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED",
						ChangeSetId: csID,
						EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED,
						Payload: &agentexecutionv1.FileReviewEvent_BaselineCaptured{
							BaselineCaptured: &agentexecutionv1.FileReviewBaselineCaptured{
								ChangeSetId: csID, TurnId: "t1", HarnessId: "deep-agent",
							},
						},
					},
					{
						EventId:     csID + ":" + csID + ":FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED",
						ChangeSetId: csID,
						EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED,
						Payload: &agentexecutionv1.FileReviewEvent_CandidateCaptured{
							CandidateCaptured: &agentexecutionv1.FileReviewCandidateCaptured{
								ChangeSetId:      csID,
								Changes:          changes,
								AggregateDigest:  "agg",
								DiffCompleteness: completeness,
							},
						},
					},
				},
			},
		},
	}
}

func fileDecisionInput(
	scope agentexecutionv1.FileDecisionScope,
	fileID string,
	action agentexecutionv1.FileDecisionAction,
	expectedDigest string,
) *agentexecutionv1.SubmitFileDecisionInput {
	return &agentexecutionv1.SubmitFileDecisionInput{
		AgentExecutionId: "aex_test",
		ChangeSetId:      "cs1",
		Scope:            scope,
		FileChangeId:     fileID,
		Action:           action,
		ExpectedDigest:   expectedDigest,
	}
}

// ackFileDecisionInput is fileDecisionInput with acknowledge_unreviewable set —
// the "keep this binary anyway" path.
func ackFileDecisionInput(
	scope agentexecutionv1.FileDecisionScope,
	fileID string,
	action agentexecutionv1.FileDecisionAction,
	expectedDigest string,
) *agentexecutionv1.SubmitFileDecisionInput {
	in := fileDecisionInput(scope, fileID, action, expectedDigest)
	in.AcknowledgeUnreviewable = true
	return in
}

// TestValidateFileDecisionTarget_CompletenessGate proves the server refuses to
// APPROVE an unreviewable target (FAILED_PRECONDITION), always permits REJECT,
// honors per-target granularity, and checks completeness before the digest gate.
// Mirrored by the Java validateTarget wiring test.
func TestValidateFileDecisionTarget_CompletenessGate(t *testing.T) {
	fileScope := agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_FILE
	setScope := agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET
	approve := agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE
	reject := agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_REJECT

	complete := &agentexecutionv1.CapturedFileChange{Id: "fc-complete", FileDigest: "d-complete", DiffComplete: true}
	incomplete := &agentexecutionv1.CapturedFileChange{Id: "fc-incomplete", FileDigest: "d-incomplete", DiffComplete: false}
	// A binary file: no text diff (diff_complete=false) but reconcilable bytes,
	// conveyed by FileContent.is_binary — the acknowledgment carve-out target.
	binary := &agentexecutionv1.CapturedFileChange{
		Id: "fc-binary", FileDigest: "d-binary", DiffComplete: false,
		After: &agentexecutionv1.FileContent{IsBinary: true},
	}

	partial := func() *agentexecutionv1.AgentExecution {
		return fileReviewExecution(
			agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_PARTIAL_BLOCKED, complete, incomplete, binary)
	}
	completeSet := func() *agentexecutionv1.AgentExecution {
		return fileReviewExecution(
			agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE, complete)
	}

	cases := []struct {
		name     string
		exec     *agentexecutionv1.AgentExecution
		input    *agentexecutionv1.SubmitFileDecisionInput
		wantCode codes.Code // codes.OK asserts a nil error
	}{
		{
			name:     "approve incomplete file is blocked",
			exec:     partial(),
			input:    fileDecisionInput(fileScope, "fc-incomplete", approve, "d-incomplete"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "reject incomplete file is allowed",
			exec:     partial(),
			input:    fileDecisionInput(fileScope, "fc-incomplete", reject, "d-incomplete"),
			wantCode: codes.OK,
		},
		{
			name:     "approve complete file inside a partial set is allowed (per-target)",
			exec:     partial(),
			input:    fileDecisionInput(fileScope, "fc-complete", approve, "d-complete"),
			wantCode: codes.OK,
		},
		{
			name:     "approve the whole partial set is blocked",
			exec:     partial(),
			input:    fileDecisionInput(setScope, "", approve, "agg"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "completeness is checked before the digest gate",
			exec:     partial(),
			input:    fileDecisionInput(fileScope, "fc-incomplete", approve, "stale-digest-user-never-saw"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "approve a complete set is allowed",
			exec:     completeSet(),
			input:    fileDecisionInput(setScope, "", approve, "agg"),
			wantCode: codes.OK,
		},
		// Binary-acknowledgment carve-out (DD-16).
		{
			name:     "approve a binary file without ack is blocked",
			exec:     partial(),
			input:    fileDecisionInput(fileScope, "fc-binary", approve, "d-binary"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "approve a binary file WITH ack is allowed",
			exec:     partial(),
			input:    ackFileDecisionInput(fileScope, "fc-binary", approve, "d-binary"),
			wantCode: codes.OK,
		},
		{
			name:     "ack does not unblock a non-binary incomplete file",
			exec:     partial(),
			input:    ackFileDecisionInput(fileScope, "fc-incomplete", approve, "d-incomplete"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "ack is ignored for a CHANGE_SET-scope approve of a partial set",
			exec:     partial(),
			input:    ackFileDecisionInput(setScope, "", approve, "agg"),
			wantCode: codes.FailedPrecondition,
		},
		{
			// The carve-out relaxes completeness ONLY — the digest gate still runs,
			// so an acknowledged binary with a stale digest is refused (and as
			// INVALID_ARGUMENT, proving completeness passed first).
			name:     "ack relaxes completeness but never the digest gate",
			exec:     partial(),
			input:    ackFileDecisionInput(fileScope, "fc-binary", approve, "stale-digest"),
			wantCode: codes.InvalidArgument,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFileDecisionTarget(tc.exec, tc.input)
			if tc.wantCode == codes.OK {
				if err != nil {
					t.Fatalf("validateFileDecisionTarget = %v, want nil", err)
				}
				return
			}
			if got := status.Code(err); got != tc.wantCode {
				t.Fatalf("validateFileDecisionTarget code = %v, want %v (err=%v)", got, tc.wantCode, err)
			}
		})
	}
}

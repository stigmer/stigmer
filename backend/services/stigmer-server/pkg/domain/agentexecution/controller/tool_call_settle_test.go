package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

func toolCallMsg(calls ...*agentexecutionv1.ToolCall) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type:      agentexecutionv1.MessageType_MESSAGE_AI,
		ToolCalls: calls,
	}
}

// Locks the settle contract: every non-terminal status settles to INTERRUPTED,
// every terminal status is untouched, and only status / completed_at /
// streaming_source change — args, results, and approval provenance survive for
// the audit trail.
func TestSettleInterruptedToolCalls(t *testing.T) {
	t.Run("settles PENDING, RUNNING, and WAITING_APPROVAL; leaves terminal statuses untouched", func(t *testing.T) {
		status := &agentexecutionv1.AgentExecutionStatus{
			Messages: []*agentexecutionv1.AgentMessage{
				toolCallMsg(
					&agentexecutionv1.ToolCall{Id: "tc-pending", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_PENDING},
					&agentexecutionv1.ToolCall{Id: "tc-running", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
					&agentexecutionv1.ToolCall{Id: "tc-gated", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL},
				),
				toolCallMsg(
					&agentexecutionv1.ToolCall{Id: "tc-completed", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
					&agentexecutionv1.ToolCall{Id: "tc-failed", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED},
					&agentexecutionv1.ToolCall{Id: "tc-skipped", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED},
					&agentexecutionv1.ToolCall{Id: "tc-interrupted", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED},
				),
			},
		}

		settled := settleInterruptedToolCalls(status, "2026-07-08T00:00:00Z")

		assert.Equal(t, 3, settled)
		for _, id := range []string{"tc-pending", "tc-running", "tc-gated"} {
			tc := findToolCall(status, id)
			assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED, tc.GetStatus(), id)
			assert.Equal(t, "2026-07-08T00:00:00Z", tc.GetCompletedAt(), id)
		}
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, findToolCall(status, "tc-completed").GetStatus())
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED, findToolCall(status, "tc-failed").GetStatus())
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED, findToolCall(status, "tc-skipped").GetStatus())
	})

	t.Run("walks sub-agent transcripts", func(t *testing.T) {
		status := &agentexecutionv1.AgentExecutionStatus{
			SubAgentExecutions: []*agentexecutionv1.SubAgentExecution{{
				Id: "sa1",
				Messages: []*agentexecutionv1.AgentMessage{
					toolCallMsg(&agentexecutionv1.ToolCall{Id: "sa-tc", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING}),
				},
			}},
		}

		settled := settleInterruptedToolCalls(status, "2026-07-08T00:00:00Z")

		assert.Equal(t, 1, settled)
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
			status.SubAgentExecutions[0].Messages[0].ToolCalls[0].GetStatus())
	})

	t.Run("preserves approval provenance, args-adjacent fields, and an existing completed_at; clears streaming_source", func(t *testing.T) {
		tc := &agentexecutionv1.ToolCall{
			Id:                  "tc-gated",
			Name:                "Shell",
			Status:              agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
			RequiresApproval:    true,
			ApprovalRequestedAt: "2026-07-07T23:00:00Z",
			ApprovalMessage:     "Approve running this command?",
			ArgsPreview:         "rm -rf ./build",
			Result:              "partial output",
			CompletedAt:         "runner-recorded",
			StreamingSource:     agentexecutionv1.ToolCallStreamingSource_TOOL_CALL_STREAMING_SOURCE_OUTPUT,
		}
		status := &agentexecutionv1.AgentExecutionStatus{Messages: []*agentexecutionv1.AgentMessage{toolCallMsg(tc)}}

		settleInterruptedToolCalls(status, "2026-07-08T00:00:00Z")

		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED, tc.GetStatus())
		assert.True(t, tc.GetRequiresApproval(), "approval provenance survives the settle")
		assert.Equal(t, "2026-07-07T23:00:00Z", tc.GetApprovalRequestedAt())
		assert.Equal(t, "Approve running this command?", tc.GetApprovalMessage())
		assert.Equal(t, "rm -rf ./build", tc.GetArgsPreview(), "the settle is honest, not a hide")
		assert.Equal(t, "partial output", tc.GetResult())
		assert.Equal(t, "runner-recorded", tc.GetCompletedAt(), "a runner-recorded timestamp is preserved")
		assert.Equal(t, agentexecutionv1.ToolCallStreamingSource_TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED,
			tc.GetStreamingSource(), "nothing streams on a dead execution")
	})

	t.Run("idempotent and nil-safe", func(t *testing.T) {
		status := &agentexecutionv1.AgentExecutionStatus{
			Messages: []*agentexecutionv1.AgentMessage{
				toolCallMsg(nil, &agentexecutionv1.ToolCall{Id: "tc", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING}),
			},
		}
		assert.Equal(t, 1, settleInterruptedToolCalls(status, "t1"))
		assert.Equal(t, 0, settleInterruptedToolCalls(status, "t2"), "re-running settles nothing")
		assert.Equal(t, "t1", findToolCall(status, "tc").GetCompletedAt())
		assert.Equal(t, 0, settleInterruptedToolCalls(nil, "t3"))
	})
}

// The merge chokepoint enforces the terminal invariant for every updateStatus
// writer: any update whose merged phase is terminal settles all in-flight tool
// calls — the runner's own terminal persists and the workflow's stub-message
// fallbacks alike.
func TestUpdateStatusMerge_SettlesInFlightToolCallsOnTerminalPhase(t *testing.T) {
	terminalPhases := []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED,
	}
	for _, phase := range terminalPhases {
		t.Run(phase.String(), func(t *testing.T) {
			existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
			incoming := &agentexecutionv1.AgentExecutionStatus{
				Phase: phase,
				Messages: []*agentexecutionv1.AgentMessage{
					toolCallMsg(&agentexecutionv1.ToolCall{Id: "tc-running", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING}),
				},
			}

			merged := runBuildStep(t, existing, incoming)

			tc := findToolCall(merged.Status, "tc-running")
			assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED, tc.GetStatus())
			assert.NotEmpty(t, tc.GetCompletedAt())
		})
	}
}

// The workflow's failure/cancellation fallbacks send a terminal phase with a
// stub message list the transcript guard rejects — the EXISTING messages (and
// their zombies) are what terminalize. The settle must run on the merged
// result, not the incoming payload.
func TestUpdateStatusMerge_SettlesExistingZombiesOnFallbackTerminalize(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
	existing.Status.Messages = []*agentexecutionv1.AgentMessage{
		{Content: "working on it"},
		toolCallMsg(&agentexecutionv1.ToolCall{Id: "tc-zombie", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING}),
	}
	// updateStatusOnFailure's shape: terminal phase + a single stub message
	// (shorter than the committed transcript, so the guard keeps the existing).
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		Error:    "system error",
		Messages: messages("Internal system error occurred during execution."),
	}

	merged := runBuildStep(t, existing, incoming)

	assert.Len(t, merged.Status.Messages, 2, "guard keeps the committed transcript")
	assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
		findToolCall(merged.Status, "tc-zombie").GetStatus(),
		"the kept transcript's zombie settles because the merged phase is terminal")
}

// Non-terminal merges settle nothing: PAUSED can resume and a gated run's
// WAITING_APPROVAL rows are live.
func TestUpdateStatusMerge_DoesNotSettleOnNonTerminalPhase(t *testing.T) {
	for _, phase := range []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
	} {
		t.Run(phase.String(), func(t *testing.T) {
			existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
			incoming := &agentexecutionv1.AgentExecutionStatus{
				Phase: phase,
				Messages: []*agentexecutionv1.AgentMessage{
					toolCallMsg(
						&agentexecutionv1.ToolCall{Id: "tc-running", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
						&agentexecutionv1.ToolCall{
							Id:               "tc-gated",
							Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
							RequiresApproval: true,
						},
					),
				},
			}

			merged := runBuildStep(t, existing, incoming)

			assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING,
				findToolCall(merged.Status, "tc-running").GetStatus())
			assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
				findToolCall(merged.Status, "tc-gated").GetStatus())
		})
	}
}

// A gated call settled at terminalization authors NO approval artifacts: the
// settle runs before EnsureApprovalRequests, so a dead gate never seeds a
// REQUESTED event, and the phase-aware projection yields zero pending
// approvals. Terminal-execution gate-exits are not per-call events by contract
// (see ApprovalEventType).
func TestUpdateStatusMerge_SettledGateAuthorsNoApprovalArtifacts(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		Messages: []*agentexecutionv1.AgentMessage{
			toolCallMsg(&agentexecutionv1.ToolCall{
				Id:               "tc-gated",
				Name:             "Shell",
				Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
				RequiresApproval: true,
			}),
		},
	}

	merged := runBuildStep(t, existing, incoming)

	tc := findToolCall(merged.Status, "tc-gated")
	assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED, tc.GetStatus())
	assert.True(t, tc.GetRequiresApproval(), "provenance survives")
	assert.Empty(t, merged.Status.GetApprovalEventStream().GetEvents(),
		"a dead gate must not seed a REQUESTED approval event")
	assert.Empty(t, merged.Status.GetPendingApprovals())
}

// Terminal phases are final (enum.proto contract): a straggler runner persist —
// an activity outliving its workflow's termination learns of it only via
// heartbeat failure — must not resurrect the phase. Recover is the one
// sanctioned un-terminalizer and runs through its own lifecycle step, never
// this merge.
func TestUpdateStatusMerge_TerminalPhaseLatch(t *testing.T) {
	t.Run("straggler IN_PROGRESS persist cannot resurrect a terminal phase, and its zombies re-settle", func(t *testing.T) {
		existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED)
		existing.Status.Messages = []*agentexecutionv1.AgentMessage{
			toolCallMsg(&agentexecutionv1.ToolCall{Id: "tc-1", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED}),
		}
		// The straggler carries the pre-termination snapshot: live phase, the
		// same row still RUNNING (equal length, id preserved — the guard
		// accepts the replacement).
		incoming := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			Messages: []*agentexecutionv1.AgentMessage{
				toolCallMsg(&agentexecutionv1.ToolCall{Id: "tc-1", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING}),
			},
		}

		merged := runBuildStep(t, existing, incoming)

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, merged.Status.Phase,
			"the latch holds: terminal phases never move via updateStatus")
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
			findToolCall(merged.Status, "tc-1").GetStatus(),
			"the reintroduced RUNNING row re-settles in the same merge (latch + settle are self-healing)")
	})

	t.Run("same terminal phase is accepted (idempotent terminal persist)", func(t *testing.T) {
		existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "m1")
		incoming := &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: messages("m1-final"),
		}

		merged := runBuildStep(t, existing, incoming)

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, merged.Status.Phase)
		assert.Equal(t, "m1-final", merged.Status.Messages[0].Content)
	})

	t.Run("a terminal phase cannot hop to a different terminal phase via updateStatus", func(t *testing.T) {
		existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED)
		incoming := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		}

		merged := runBuildStep(t, existing, incoming)

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, merged.Status.Phase)
	})

	t.Run("non-terminal to terminal still transitions normally", func(t *testing.T) {
		existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
		incoming := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		}

		merged := runBuildStep(t, existing, incoming)

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, merged.Status.Phase)
	})
}

// The stale-workflow reconcilers preserve messages verbatim while terminalizing
// — the settle they call must resolve the very gate the user was acting on.
// Exercised at the helper level here; the reconcilers' wiring is one line each.
func TestReconcileStaleShape_SettlesPreservedGate(t *testing.T) {
	reconciled := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-stale"},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Messages: []*agentexecutionv1.AgentMessage{
				toolCallMsg(&agentexecutionv1.ToolCall{
					Id:               "tc-gated",
					Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
					RequiresApproval: true,
				}),
				{Type: agentexecutionv1.MessageType_MESSAGE_SYSTEM, Content: "The workflow backing this execution is no longer running."},
			},
		},
	}

	settled := settleInterruptedToolCalls(reconciled.Status, "2026-07-08T00:00:00Z")

	assert.Equal(t, 1, settled)
	assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
		findToolCall(reconciled.Status, "tc-gated").GetStatus())
}

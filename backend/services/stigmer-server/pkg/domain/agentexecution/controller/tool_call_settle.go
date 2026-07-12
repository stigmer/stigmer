package agentexecution

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// isTerminalExecutionPhase reports whether phase is one of the four terminal
// execution phases (COMPLETED / FAILED / CANCELLED / TERMINATED).
//
// Deliberately distinct from the transcript guard's isTerminalPhase
// (subscribe.go), which omits TERMINATED so a terminated execution's committed
// transcript stays protected from free rewrites. This predicate answers a
// different question — "will this execution ever run again?" — and TERMINATED
// executions will not, so their in-flight tool calls must settle.
func isTerminalExecutionPhase(phase agentexecutionv1.ExecutionPhase) bool {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

// settleInterruptedToolCalls settles every non-terminal tool call — PENDING,
// RUNNING, or WAITING_APPROVAL — to TOOL_CALL_INTERRUPTED, across the top-level
// transcript and every sub-agent transcript, in place. It enforces the
// invariant that a terminal execution carries zero non-terminal tool calls
// (issue #207): a terminal execution's workflow is gone, so an in-flight call
// will never receive its terminal event and a gated call can never be decided.
//
// This is the tool-call analog of cancelInProgressSubAgents and is called by
// every terminal writer: the updateStatus merge chokepoint (on a terminal
// merged phase), the Cancel/Terminate lifecycle transition, and the
// stale-workflow reconcilers. Idempotent — settled rows are terminal and
// re-running is a no-op.
//
// The settle is honest, not a hide: args, partial results, and approval
// provenance (requires_approval, approval_requested_at, ...) are preserved for
// the audit trail. Only the status, the completion timestamp (when empty, so a
// runner-recorded timestamp survives), and the streaming marker change —
// nothing streams on a dead execution, so a frozen streaming_source must not
// leave clients rendering a live stream.
//
// A gated (WAITING_APPROVAL) call settled here authors NO approval event:
// terminal-execution gate-exits are deliberately not modeled as per-call
// events (see ApprovalEventType — a terminal execution simply projects to zero
// pending approvals; RETRACTED is reserved for in-flight withdrawals).
//
// Returns the number of tool calls settled, for the callers' logs.
func settleInterruptedToolCalls(status *agentexecutionv1.AgentExecutionStatus, completedAt string) int {
	if status == nil {
		return 0
	}
	settled := settleInterruptedToolCallsInMessages(status.GetMessages(), completedAt)
	for _, sa := range status.GetSubAgentExecutions() {
		settled += settleInterruptedToolCallsInMessages(sa.GetMessages(), completedAt)
	}
	return settled
}

func settleInterruptedToolCallsInMessages(messages []*agentexecutionv1.AgentMessage, completedAt string) int {
	settled := 0
	for _, m := range messages {
		for _, tc := range m.GetToolCalls() {
			if tc == nil {
				continue
			}
			switch tc.GetStatus() {
			case agentexecutionv1.ToolCallStatus_TOOL_CALL_PENDING,
				agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING,
				agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL:
				tc.Status = agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED
				if tc.GetCompletedAt() == "" {
					tc.CompletedAt = completedAt
				}
				tc.StreamingSource = agentexecutionv1.ToolCallStreamingSource_TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED
				settled++
			}
		}
	}
	return settled
}

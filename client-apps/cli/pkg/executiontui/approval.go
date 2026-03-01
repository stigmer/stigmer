package executiontui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// handleApprovalKey processes a key press during an active approval prompt.
//
// Approval-specific keys (a/s/r) trigger the approval decision. All other keys
// are delegated to handleNavigationKey so the user can Tab/Enter to expand tool
// blocks and scroll the viewport while inspecting content before deciding.
//
// When an approval key is pressed:
//  1. The approval response is sent to the goroutine via the response channel.
//  2. The tool block badge is updated in-place to reflect the decision.
//  3. The approval context block is replaced with a compact confirmation line.
//  4. The approval state is cleared.
//
// IMPORTANT: This handler does NOT issue a new listenForEvents command.
// The listenForEvents goroutine started by handleExecutionEvent (when it
// processed the ApprovalNeededEvent) is still alive, blocking on the events
// channel. After sendCmd delivers the approval response, the gRPC goroutine
// unblocks and resumes streaming events — the existing listener will receive
// the next event. Issuing a second listenForEvents here would create two
// concurrent readers on the same channel, causing a race condition where one
// reader gets the event and the other gets the channel-close signal, leading
// to spurious "stream closed unexpectedly" errors.
func (m Model) handleApprovalKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.approval == nil {
		return m, nil
	}

	// Approval decision keys.
	var action string
	switch msg.String() {
	case "a":
		action = "approve"
	case "s":
		action = "skip"
	case "r":
		action = "reject"
	default:
		// Not an approval key — delegate to navigation so the user can
		// Tab/Enter to expand tool blocks and scroll the viewport while
		// deciding whether to approve.
		return m.handleNavigationKey(msg)
	}

	// Send the response to the gRPC goroutine.
	var comment string
	if action == "reject" {
		comment = "rejected by user"
	}
	response := ApprovalResponse{
		Action:     action,
		ToolCallID: m.approval.toolCallID,
		Comment:    comment,
	}

	// Use a command to send the response asynchronously, preventing the
	// Update loop from blocking if the channel is not immediately ready.
	sendCmd := sendApprovalResponse(m.activeApprovals, response)

	// Update the tool block badge in-place. For "approve", the tool will
	// resume running (⏳). For "skip" and "reject", the tool reaches a
	// terminal state immediately (⏭ / ✗).
	toolCallID := m.approval.toolCallID
	if idx, ok := m.runningTools[toolCallID]; ok && idx < len(m.blocks) {
		if tc := m.blocks[idx].toolCall; tc != nil {
			var newState string
			switch action {
			case "approve":
				newState = "running"
			case "skip":
				newState = "skipped"
			case "reject":
				newState = "failed"
			}
			m.updateToolBadge(toolCallID, *tc, newState, m.blocks[idx].subAgentID)
		}
	}

	// Replace the approval context block with a compact confirmation line.
	if m.approvalBlockIdx >= 0 && m.approvalBlockIdx < len(m.blocks) {
		m.blocks[m.approvalBlockIdx] = newSystemBlock(
			renderApprovalConfirmation(action, m.approval.toolName),
		)
	}
	m.approvalBlockIdx = -1

	// Clear approval state.
	m.approval = nil

	// Refresh viewport. The existing listenForEvents goroutine (from
	// handleExecutionEvent) will deliver the next event when it arrives.
	m.refreshViewport()

	return m, sendCmd
}

// sendApprovalResponse returns a tea.Cmd that sends the approval response
// to the gRPC goroutine's channel. This runs asynchronously in Bubbletea's
// command goroutine pool.
func sendApprovalResponse(ch chan<- ApprovalResponse, resp ApprovalResponse) tea.Cmd {
	return func() tea.Msg {
		ch <- resp
		return nil
	}
}

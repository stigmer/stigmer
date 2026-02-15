package executiontui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// handleApprovalKey processes a key press during an active approval prompt.
// Valid keys are a (approve), s (skip), r (reject). Other keys are ignored.
//
// When a valid key is pressed:
//  1. The approval response is sent to the goroutine via the response channel.
//  2. The approval state is cleared.
//  3. A confirmation block is appended.
//  4. The model continues listening for events.
func (m Model) handleApprovalKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.approval == nil {
		return m, nil
	}

	var action string
	switch msg.String() {
	case "a":
		action = "approve"
	case "s":
		action = "skip"
	case "r":
		action = "reject"
	default:
		// Ignore unrecognized keys during approval.
		return m, nil
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
	sendCmd := sendApprovalResponse(m.cfg.ApprovalResponses, response)

	// Append a confirmation block showing the action and tool name.
	m.blocks = append(m.blocks, newSystemBlock(
		renderApprovalConfirmation(action, m.approval.toolName),
	))

	// Clear approval state.
	m.approval = nil

	// Refresh viewport and continue listening.
	m.refreshViewport()

	return m, tea.Batch(sendCmd, listenForEvents(m.cfg.Events))
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

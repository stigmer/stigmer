package root

import (
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// handleKeyPress routes keystrokes based on the model's current UI state.
// Ctrl+O is a global toggle that works in all states. Other keys are
// dispatched to state-specific handlers.
func (m inlineBubbleModel) handleKeyPress(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "ctrl+o" {
		return m.handleToggleExpand()
	}

	if m.approvalActive && m.approvalDecisionCh != nil {
		return m.handleApprovalKey(msg)
	}

	if m.textInputActive && m.textInputCh != nil {
		return m.handleTextInputKey(msg)
	}

	return m.handleIdleKey(msg)
}

// handleToggleExpand sends a non-blocking signal on toggleExpandCh to
// request the event loop to flip expand mode and re-commit history.
func (m inlineBubbleModel) handleToggleExpand() (tea.Model, tea.Cmd) {
	if m.toggleExpandCh != nil {
		select {
		case m.toggleExpandCh <- struct{}{}:
		default:
		}
	}
	return m, nil
}

// handleApprovalKey processes keystrokes during the approval prompt.
// Arrow keys update the selection index. Enter and number keys deliver
// the decision via approvalDecisionCh. Esc/Ctrl+C signal session exit.
func (m inlineBubbleModel) handleApprovalKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up":
		if m.approvalSelected > 0 {
			m.approvalSelected--
		}
	case "down":
		if m.approvalSelected < 2 {
			m.approvalSelected++
		}
	case "enter":
		action := approvalActionByIndex(m.approvalSelected)
		m.approvalDecisionCh <- approvalDecision{action: action}
	case "1":
		m.approvalDecisionCh <- approvalDecision{action: approval.ActionApprove}
	case "2":
		m.approvalDecisionCh <- approvalDecision{action: approval.ActionSkip}
	case "3":
		m.approvalDecisionCh <- approvalDecision{action: approval.ActionReject}
	case "esc", "ctrl+c":
		m.approvalDecisionCh <- approvalDecision{err: approval.ErrSessionExit}
	}
	return m, nil
}

// handleTextInputKey processes keystrokes during follow-up text input.
// Runes are appended to the buffer. Backspace removes the last rune.
// Enter submits the buffer. Ctrl+D and Ctrl+C submit empty (exit).
func (m inlineBubbleModel) handleTextInputKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "backspace":
		if len(m.textInputBuffer) > 0 {
			_, size := utf8.DecodeLastRuneInString(m.textInputBuffer)
			m.textInputBuffer = m.textInputBuffer[:len(m.textInputBuffer)-size]
		}
	case "enter":
		m.textInputCh <- m.textInputBuffer
	case "ctrl+d", "ctrl+c":
		m.textInputCh <- ""
	case "space":
		m.textInputBuffer += " "
	default:
		if msg.Text != "" {
			m.textInputBuffer += msg.Text
		}
	}
	return m, nil
}

// handleIdleKey processes keystrokes when no interactive prompt is active.
// Ctrl+C sends a cancel signal to the event loop.
func (m inlineBubbleModel) handleIdleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "ctrl+c" && m.cancelCh != nil {
		select {
		case m.cancelCh <- struct{}{}:
		default:
		}
	}
	return m, nil
}

// approvalActionByIndex maps a menu selection index to the corresponding
// approval action. Matches the order in approval.RenderMenu.
func approvalActionByIndex(index int) approval.Action {
	switch index {
	case 0:
		return approval.ActionApprove
	case 1:
		return approval.ActionSkip
	case 2:
		return approval.ActionReject
	default:
		return approval.ActionSkip
	}
}

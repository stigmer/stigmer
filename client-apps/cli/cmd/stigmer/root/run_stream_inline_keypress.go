package root

import (
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

// handleTextInputKey intercepts submit/cancel keys and delegates all
// other keystrokes to the embedded textinput.Model for cursor movement,
// word navigation, deletion, and character input.
//
// Ctrl+D follows Unix convention: empty input = EOF (exit), non-empty
// input = delete character forward (handled by textinput).
func (m inlineBubbleModel) handleTextInputKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		m.textInputCh <- m.textInput.Value()
		return m, nil
	case "ctrl+c":
		m.textInputCh <- ""
		return m, nil
	case "ctrl+d":
		if m.textInput.Value() == "" {
			m.textInputCh <- ""
			return m, nil
		}
	}

	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	return m, cmd
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
// approval action. Matches the order in approval.RenderMenu. The model
// constrains approvalSelected to [0,2] via handleApprovalKey bounds
// checks, so the default branch is unreachable in practice. It falls
// back to Skip as the safest no-op action (does not execute the tool,
// does not terminate the session).
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

package executiontui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// inputAreaHeight is the number of terminal lines reserved for the input
// composer zone (separator line + textarea line). Subtracted from the
// terminal height when computing the viewport size, so the layout is
// stable whether the input is active or dimmed.
const inputAreaHeight = 2

// Styles for the input area separator and placeholder text.
var (
	inputSeparatorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	inputPlaceholderStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("243"))
)

// hasInputArea returns true when the TUI should display the input composer
// zone. This is the case when a FollowUpFn is configured, meaning the
// session supports conversational follow-ups. When false, the layout is
// identical to the pre-Phase 2 single-execution TUI.
func (m Model) hasInputArea() bool {
	return m.cfg.FollowUpFn != nil
}

// renderInputArea renders the input composer zone: a separator line followed
// by either the active textarea or a dimmed placeholder.
//
// When inputActive, the textarea is focused and the user can type. Otherwise,
// a muted "Agent is working..." placeholder signals that the agent is
// processing and the input will become available when it finishes.
func (m Model) renderInputArea() string {
	separator := inputSeparatorStyle.Render(strings.Repeat("─", m.width))

	if m.inputActive {
		return separator + "\n" + m.textarea.View()
	}

	placeholder := inputPlaceholderStyle.Render("  Agent is working...")
	return separator + "\n" + placeholder
}

// handleInputKey processes keyboard input when the input composer is active.
// The textarea captures all printable keys. Special keys:
//   - Esc: exit the session (sets done, quits)
//   - Enter: submit the message as a follow-up (if non-empty)
//   - All other keys: forwarded to the textarea component
func (m Model) handleInputKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyEsc:
		m.inputActive = false
		m.done = true
		return m, tea.Quit

	case tea.KeyEnter:
		message := strings.TrimSpace(m.textarea.Value())
		if message == "" {
			return m, nil
		}

		// Show the user's message in the transcript immediately.
		m.blocks = append(m.blocks, newHumanBlock(renderHumanContent(message)))
		m.textarea.Reset()
		m.textarea.Blur()
		m.inputActive = false
		m.refreshViewport()

		// Create the follow-up execution asynchronously. The result
		// arrives as a followUpStartedMsg or followUpErrorMsg.
		return m, m.executeFollowUpCmd(message)

	default:
		var cmd tea.Cmd
		m.textarea, cmd = m.textarea.Update(msg)
		return m, cmd
	}
}

// executeFollowUpCmd returns a tea.Cmd that calls FollowUpFn asynchronously.
// The result is delivered as a followUpStartedMsg or followUpErrorMsg.
func (m Model) executeFollowUpCmd(message string) tea.Cmd {
	followUpFn := m.cfg.FollowUpFn
	return func() tea.Msg {
		result, err := followUpFn(message)
		if err != nil {
			return followUpErrorMsg{err: err}
		}
		return followUpStartedMsg{result: result}
	}
}


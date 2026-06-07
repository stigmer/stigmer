package approval

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// promptPhase tracks the current stage of the approval prompt.
type promptPhase int

const (
	phaseSelect  promptPhase = iota // User is choosing an action (Approve/Skip/Reject)
	phaseComment                    // User is entering a rejection reason
)

// promptChoice represents a selectable option in the approval prompt.
type promptChoice struct {
	action Action
	label  string
	desc   string
}

// defaultChoices are the approval actions presented to the user.
var defaultChoices = []promptChoice{
	{action: ActionApprove, label: "Approve", desc: "Execute the tool"},
	{action: ActionApproveAll, label: "Approve & don't ask again", desc: "Approve and stop gating the rest of this run"},
	{action: ActionSkip, label: "Skip", desc: "Continue without executing"},
	{action: ActionReject, label: "Reject", desc: "Fail the execution"},
}

// promptModel is the Bubbletea model for the interactive approval prompt.
//
// It supports two phases:
//  1. Action selection — the user picks Approve, Skip, or Reject
//  2. Comment input — if Reject is selected and askComment is true,
//     the user can enter an optional rejection reason
type promptModel struct {
	phase      promptPhase
	choices    []promptChoice
	cursor     int
	askComment bool

	textInput   textinput.Model
	decision    *Decision
	sessionExit bool // Esc or Ctrl+C: exit the entire session
}

// newPromptModel creates a new approval prompt model.
// If askComment is true, selecting Reject transitions to a comment input phase.
func newPromptModel(askComment bool) promptModel {
	ti := textinput.New()
	ti.Placeholder = "optional"
	ti.Prompt = "  Rejection reason: "
	ti.CharLimit = 500

	return promptModel{
		phase:      phaseSelect,
		choices:    defaultChoices,
		askComment: askComment,
		textInput:  ti,
	}
}

// Init implements tea.Model. No initial command is needed.
func (m promptModel) Init() tea.Cmd {
	return nil
}

// Update implements tea.Model. It delegates to the phase-specific handler.
func (m promptModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch m.phase {
	case phaseSelect:
		return m.updateSelect(msg)
	case phaseComment:
		return m.updateComment(msg)
	}
	return m, nil
}

// View implements tea.Model. It delegates to the phase-specific renderer.
func (m promptModel) View() tea.View {
	var content string
	switch m.phase {
	case phaseSelect:
		content = m.viewSelect()
	case phaseComment:
		content = m.viewComment()
	}
	return tea.NewView(content)
}

// --- Selection phase ---

func (m promptModel) updateSelect(msg tea.Msg) (tea.Model, tea.Cmd) {
	keyMsg, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return m, nil
	}

	switch keyMsg.String() {
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.choices)-1 {
			m.cursor++
		}
	case "enter":
		selected := m.choices[m.cursor]
		m.decision = &Decision{Action: selected.action}

		// Reject with comment: transition to comment phase
		if selected.action == ActionReject && m.askComment {
			m.phase = phaseComment
			m.textInput.Focus()
			return m, textinput.Blink
		}

		return m, tea.Quit
	case "esc", "ctrl+c":
		m.sessionExit = true
		return m, tea.Quit
	}

	return m, nil
}

func (m promptModel) viewSelect() string {
	var b strings.Builder
	b.WriteString("\n")

	for i, choice := range m.choices {
		if i == m.cursor {
			b.WriteString(activeChoiceStyle.Render(fmt.Sprintf("  ▸ %s", choice.label)))
			b.WriteString(choiceDescStyle.Render(fmt.Sprintf(" — %s", choice.desc)))
		} else {
			b.WriteString(inactiveChoiceStyle.Render(fmt.Sprintf("    %s", choice.label)))
			b.WriteString(choiceDescStyle.Render(fmt.Sprintf(" — %s", choice.desc)))
		}
		b.WriteString("\n")
	}

	b.WriteString("\n")
	b.WriteString(promptHintStyle.Render("  ↑↓ move · enter select · esc/ctrl+c exit"))
	b.WriteString("\n")

	return b.String()
}

// --- Comment phase ---

func (m promptModel) updateComment(msg tea.Msg) (tea.Model, tea.Cmd) {
	if keyMsg, ok := msg.(tea.KeyPressMsg); ok {
		switch keyMsg.String() {
		case "enter":
			m.decision.Comment = m.textInput.Value()
			return m, tea.Quit
		case "esc":
			return m, tea.Quit
		case "ctrl+c":
			m.sessionExit = true
			m.decision = nil
			return m, tea.Quit
		}
	}

	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	return m, cmd
}

func (m promptModel) viewComment() string {
	var b strings.Builder
	b.WriteString("\n")
	b.WriteString(m.textInput.View())
	b.WriteString("\n\n")
	b.WriteString(promptHintStyle.Render("  enter submit  esc skip"))
	b.WriteString("\n")
	return b.String()
}

// --- Styles ---

var (
	activeChoiceStyle   = lipgloss.NewStyle().Bold(true)
	inactiveChoiceStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	choiceDescStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	promptHintStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
)

package root

import tea "github.com/charmbracelet/bubbletea"

// inlineBubbleModel is the Bubbletea model for the inline renderer. In Phase 1
// it acts as a passive shell: View() returns "" (no active region), Update()
// passes messages through without side effects, and Init() produces no initial
// command. The tea.Program running this model owns the stderr writer via
// tea.WithOutput, giving Bubbletea accurate row tracking for all content
// committed through Program.Println.
//
// Subsequent migration phases will progressively move rendering logic (spinner,
// header, approval, streaming, follow-up) into Update/View, replacing manual
// ANSI cursor math with Bubbletea-managed re-rendering.
type inlineBubbleModel struct{}

func newInlineBubbleModel() inlineBubbleModel {
	return inlineBubbleModel{}
}

func (m inlineBubbleModel) Init() tea.Cmd {
	return nil
}

func (m inlineBubbleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	return m, nil
}

func (m inlineBubbleModel) View() string {
	return ""
}

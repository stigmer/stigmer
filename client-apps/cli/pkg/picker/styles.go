package picker

import "charm.land/lipgloss/v2"

var (
	promptStyle       = lipgloss.NewStyle().Bold(true)
	activeItemStyle   = lipgloss.NewStyle().Bold(true)
	inactiveItemStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	subtitleStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	metaStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
	hintStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
	cursorGlyph       = promptStyle.Render("> ")
	blankCursor       = "  "
	loadingStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
	errStyle          = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	emptyStyle        = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
)

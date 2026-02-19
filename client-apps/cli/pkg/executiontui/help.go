package executiontui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Help panel styles.
var (
	helpTitleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			MarginBottom(1)

	helpSectionStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("6"))

	helpKeyStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("15")).
			Width(20)

	helpDescStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("8"))

	helpDismissStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("8")).
				MarginTop(1)
)

// helpBinding represents a single key → description pair in the help panel.
type helpBinding struct {
	key  string
	desc string
}

// helpSection groups related key bindings under a heading.
type helpSection struct {
	title    string
	bindings []helpBinding
}

// helpSections returns the structured keybinding reference for the help panel.
func helpSections() []helpSection {
	return []helpSection{
		{
			title: "Navigation",
			bindings: []helpBinding{
				{"↑ / ↓  or  k / j", "Scroll up / down"},
				{"PgUp / PgDn", "Page up / down"},
				{"g", "Jump to top"},
				{"G", "Jump to bottom (resume auto-scroll)"},
			},
		},
		{
			title: "Tool Results",
			bindings: []helpBinding{
				{"Tab", "Focus next expandable block"},
				{"Shift+Tab", "Focus previous expandable block"},
				{"Enter", "Expand / collapse focused block"},
			},
		},
		{
			title: "Approval",
			bindings: []helpBinding{
				{"a", "Approve tool call"},
				{"s", "Skip tool call"},
				{"r", "Reject tool call"},
			},
		},
		{
			title: "Execution Control",
			bindings: []helpBinding{
				{"c", "Cancel execution (with confirmation)"},
			},
		},
		{
			title: "Conversation",
			bindings: []helpBinding{
				{"Enter", "Send follow-up message (when input is active)"},
				{"Esc", "Exit session (when input is active)"},
			},
		},
		{
			title: "General",
			bindings: []helpBinding{
				{"?", "Toggle this help"},
				{"q / Ctrl+C", "Detach (execution continues in background)"},
			},
		},
	}
}

// renderHelp produces the help panel content that replaces the viewport when
// help is active. The content is vertically centered within the available space.
func renderHelp(width, height int) string {
	var lines []string

	lines = append(lines, helpTitleStyle.Render("Keyboard Shortcuts"))

	for _, section := range helpSections() {
		lines = append(lines, helpSectionStyle.Render(section.title))
		for _, b := range section.bindings {
			line := "  " + helpKeyStyle.Render(b.key) + helpDescStyle.Render(b.desc)
			lines = append(lines, line)
		}
		lines = append(lines, "") // blank line between sections
	}

	lines = append(lines, helpDismissStyle.Render("Press ? or Esc to close"))

	content := strings.Join(lines, "\n")

	// Center the content vertically within the viewport height.
	contentLines := strings.Count(content, "\n") + 1
	topPad := (height - contentLines) / 2
	if topPad < 0 {
		topPad = 0
	}

	return strings.Repeat("\n", topPad) + content
}

package executiontui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	"github.com/charmbracelet/lipgloss"
)

// Layout constants for the header and footer areas.
// These are subtracted from the terminal height to compute the viewport size.
const (
	headerHeight = 2 // title line + separator
	footerHeight = 2 // separator + key hints
)

// Styles for the header, footer, and status indicator.
var (
	headerStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("15")).
			Background(lipgloss.Color("8"))

	footerStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("8"))

	phaseIndicatorStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("6"))
)

// View implements tea.Model. It composes the header, viewport, and footer
// into a single string for Bubbletea to render.
func (m Model) View() string {
	if !m.ready {
		return "  Initializing..."
	}

	header := m.renderHeader()
	footer := m.renderFooter()

	return fmt.Sprintf("%s\n%s\n%s", header, m.viewport.View(), footer)
}

// renderHeader returns the top status bar showing execution ID and phase.
func (m Model) renderHeader() string {
	phase := phaseIndicatorStyle.Render(phaseIcon(m.phase) + " " + m.phase)
	title := fmt.Sprintf("  Execution: %s  %s", m.cfg.ExecutionID, phase)

	// Pad the header to full width for a clean bar appearance.
	padding := m.width - lipgloss.Width(title)
	if padding < 0 {
		padding = 0
	}
	bar := headerStyle.Render(title + strings.Repeat(" ", padding))

	return bar
}

// renderFooter returns the bottom key hints bar.
func (m Model) renderFooter() string {
	var hints string
	if m.approval != nil {
		hints = "  [a] Approve  [s] Skip  [r] Reject  [q] Quit"
	} else {
		hints = "  ↑↓ scroll  q quit"
	}

	// Pad footer to full width.
	padding := m.width - lipgloss.Width(hints)
	if padding < 0 {
		padding = 0
	}
	return footerStyle.Render(hints + strings.Repeat(" ", padding))
}

// phaseIcon returns a compact icon for the execution phase.
func phaseIcon(phase string) string {
	switch phase {
	case "pending":
		return "⏳"
	case "in_progress":
		return "▶"
	case "completed":
		return "✅"
	case "failed":
		return "❌"
	case "cancelled", "terminated":
		return "⚠️"
	case "waiting_for_approval":
		return "⏸"
	default:
		return "•"
	}
}

// newViewport creates a viewport.Model configured for the execution TUI.
func newViewport(width, height int) viewport.Model {
	vp := viewport.New(width, height)
	vp.SetContent("")
	return vp
}

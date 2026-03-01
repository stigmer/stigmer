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
//
// When the help panel is active, it replaces the viewport content while
// preserving the header and footer chrome. The viewport scroll position
// is untouched so it restores seamlessly when help is dismissed.
func (m Model) View() string {
	if !m.ready {
		return "  Initializing..."
	}

	header := m.renderHeader()
	footer := m.renderFooter()

	content := m.viewport.View()
	if m.showHelp {
		content = renderHelp(m.width, m.viewport.Height)
	}

	if m.hasInputArea() {
		inputArea := m.renderInputArea()
		return fmt.Sprintf("%s\n%s\n%s\n%s", header, content, inputArea, footer)
	}

	return fmt.Sprintf("%s\n%s\n%s", header, content, footer)
}

// renderHeader returns the top status bar showing execution ID and phase.
//
// The spinner animates in two situations:
//   - During "pending": signals the TUI is alive while waiting for the agent.
//   - During "in_progress" when thinkingVisible: signals the agent is alive
//     but processing (no events for > 2 seconds). This replaces the static
//     "▶ in_progress" with an animated dot to reassure the user.
func (m Model) renderHeader() string {
	var phaseIndicator string
	if m.phase == "pending" || m.thinkingVisible {
		phaseIndicator = phaseIndicatorStyle.Render(m.spinner.View() + " " + m.phase)
	} else {
		phaseIndicator = phaseIndicatorStyle.Render(phaseIcon(m.phase) + " " + m.phase)
	}

	sessionLabel := m.cfg.SessionID
	if m.cfg.SessionSubject != "" {
		sessionLabel = m.cfg.SessionSubject
	}

	var title string
	if m.inputActive {
		title = fmt.Sprintf("  Session: %s", sessionLabel)
	} else if m.cfg.SessionID != "" {
		title = fmt.Sprintf("  Session: %s  %s", sessionLabel, phaseIndicator)
	} else {
		title = fmt.Sprintf("  Execution: %s  %s", m.cfg.ExecutionID, phaseIndicator)
	}

	// Pad the header to full width for a clean bar appearance.
	padding := m.width - lipgloss.Width(title)
	if padding < 0 {
		padding = 0
	}
	bar := headerStyle.Render(title + strings.Repeat(" ", padding))

	return bar
}

// renderFooter returns the bottom key hints bar.
//
// The footer adapts to the current interaction state (priority order):
//  1. Input active: execution done, input composer focused — Enter/Esc hints
//  2. Done: execution finished (no follow-up) — shows phase result and exit hint
//  3. Cancel confirm: shows y/n prompt
//  4. Cancelling: shows cancelling indicator with detach hint
//  5. Approval active: shows approval action keys
//  6. Scroll paused: user scrolled away from bottom — shows resume hint
//  7. Normal: auto-scrolling — shows standard navigation hints
//
// When the execution is still running, "quit" is labeled "detach" to make
// it clear that exiting the TUI does not stop the execution.
func (m Model) renderFooter() string {
	var hints string
	switch {
	case m.inputActive:
		hints = "  ↑↓ scroll"
		if m.hasExpandableBlocks() {
			hints += "  Tab/S-Tab focus  Enter expand"
		}
		hints += "  Enter send  Esc exit"
	case m.done:
		hints = "  " + doneFooterText(m.phase) + "  ↑↓ scroll"
		if m.hasExpandableBlocks() {
			hints += "  Tab/S-Tab focus  Enter expand"
		}
		hints += "  q exit"
	case m.cancelConfirm:
		hints = "  Cancel execution?  [y] yes  [n] no"
	case m.cancelling:
		hints = "  ⏳ Cancelling...  ↑↓ scroll  q detach"
	case m.approval != nil:
		if m.approval.toolName != "" {
			hints = fmt.Sprintf("  [a] Approve (%s)  [s] Skip  [r] Reject  [q] Detach", m.approval.toolName)
		} else {
			hints = "  [a] Approve  [s] Skip  [r] Reject  [q] Detach"
		}
	case !m.autoScroll:
		// Scroll paused — user scrolled away from the bottom.
		if m.hasExpandableBlocks() {
			hints = "  ↓ Paused — G resume  Tab/S-Tab focus  Enter expand  c cancel  ? help  q detach"
		} else {
			hints = "  ↓ Paused — G resume  c cancel  ? help  q detach"
		}
	case m.hasExpandableBlocks():
		hints = "  ↑↓ scroll  Tab/S-Tab focus  Enter expand  c cancel  ? help  q detach"
	default:
		hints = "  ↑↓ scroll  c cancel  ? help  q detach"
	}

	// Pad footer to full width.
	padding := m.width - lipgloss.Width(hints)
	if padding < 0 {
		padding = 0
	}
	return footerStyle.Render(hints + strings.Repeat(" ", padding))
}

// doneFooterText returns a phase-appropriate completion label for the footer.
func doneFooterText(phase string) string {
	switch phase {
	case "completed":
		return "✅ Completed —"
	case "failed":
		return "❌ Failed —"
	case "cancelled":
		return "⚠️  Cancelled —"
	case "terminated":
		return "⚠️  Terminated —"
	default:
		return "Done —"
	}
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

package root

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"golang.org/x/term"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
)

// sessionHeaderInfo holds metadata displayed in the bordered session header
// panel rendered at the start of every inline streaming session.
type sessionHeaderInfo struct {
	AgentName  string
	SessionID  string
	Subject    string
	Model      string
	Version    string
	Workspaces []string

	// IsResumed is true when the user opened an existing session via
	// "stigmer resume <session-id>". Resumed sessions skip the greeting
	// and recent sessions section to keep the header compact.
	IsResumed bool

	// RecentSessions holds a short list of the user's most recent sessions
	// fetched asynchronously from the backend. Populated via the
	// recentSessionsCh channel after the initial header render. Only
	// displayed for new (non-resumed) sessions.
	RecentSessions []recentSession
}

// recentSession holds the metadata for one entry in the "Recent sessions"
// section of the welcome header. Fetched from the backend's session list API.
type recentSession struct {
	SessionID string
	Subject   string
	CreatedAt time.Time
}

// labelWidth is the fixed column width for left-aligned labels in the
// session header. Chosen to accommodate the longest label ("Workspaces")
// plus a colon and trailing space.
const labelWidth = 12

// minSideBySidePanelWidth is the minimum panel width (columns) required
// to activate the two-column (metadata | recent sessions) layout. Below
// this threshold, the header falls back to the stacked vertical layout.
const minSideBySidePanelWidth = 96

// maxHeaderPanelWidth caps the header panel width to prevent absurdly
// wide panels on ultra-wide terminals.
const maxHeaderPanelWidth = 120

// minRightColumnWidth is the narrowest the recent-sessions column may be
// before the layout falls back to stacked. Ensures the resume hint and
// session IDs remain legible.
const minRightColumnWidth = 36

// renderSessionHeader writes a bordered panel to w summarizing the session
// metadata. On wide terminals (>= minSideBySidePanelWidth), the metadata
// and recent sessions are displayed side-by-side with a vertical divider.
// On narrow terminals, the sections stack vertically.
//
// Fields that are empty are omitted from the output. At minimum, SessionID
// should be populated; the function gracefully handles all fields being empty.
func renderSessionHeader(w io.Writer, info sessionHeaderInfo) {
	content, pw := formatHeaderPanel(info, terminalWidth())
	if content == "" {
		return
	}

	output := panel.Render(content, panel.Options{
		Title: headerTitle(info.Version, false),
		Style: panel.StyleBrand,
		Width: pw,
	})
	fmt.Fprintf(w, "%s\n\n", output)
}

// headerTitle composes the panel title from the version string and expand
// mode flag. Returns "Stigmer" when no meaningful version is present,
// "Stigmer v0.12.3" when one is, and appends " · expanded" when toggled.
func headerTitle(version string, expanded bool) string {
	title := "Stigmer"
	if version != "" && version != "dev" {
		title += " v" + version
	}
	if expanded {
		title += " · expanded"
	}
	return title
}

// formatSessionHeaderContent builds the content string for the session header
// panel. Convenience wrapper that queries terminal width automatically.
func formatSessionHeaderContent(info sessionHeaderInfo) string {
	content, _ := formatHeaderPanel(info, terminalWidth())
	return content
}

// formatHeaderPanel builds the content string for the session header panel
// and returns the panel width to use. The layout adapts to the available
// terminal width:
//
//   - Wide terminal: metadata (left) and recent sessions (right) arranged
//     side-by-side with a dim vertical divider.
//   - Narrow terminal (or resumed/no recent data): sections stacked
//     vertically, matching the original layout.
//
// termWidth is the terminal width in columns (pass 0 to force stacked).
func formatHeaderPanel(info sessionHeaderInfo, termWidth int) (string, int) {
	metadata := formatMetadataSection(info)
	hasContent := metadata != "" || len(info.RecentSessions) > 0
	if !hasContent {
		return "", panel.DefaultWidth
	}

	showRecent := !info.IsResumed && len(info.RecentSessions) > 0

	// Attempt side-by-side layout on wide terminals.
	if showRecent && metadata != "" {
		pw := headerPanelWidth(termWidth)
		if pw >= minSideBySidePanelWidth {
			contentWidth := pw - 2 - (2 * panel.Padding)
			metaWidth := maxLineWidth(metadata)
			rightWidth := contentWidth - metaWidth - 3 // 3 chars for " │ "

			if rightWidth >= minRightColumnWidth {
				greeting := lipgloss.NewStyle().Bold(true).Render("Welcome back!")
				body := composeSideBySide(metadata, info.RecentSessions, rightWidth)
				return greeting + "\n\n" + body, pw
			}
		}
	}

	// Stacked layout (narrow terminal, resumed session, or no recent data).
	var sections []string
	if !info.IsResumed {
		greeting := lipgloss.NewStyle().Bold(true).Render("Welcome back!")
		sections = append(sections, greeting)
	}
	if metadata != "" {
		sections = append(sections, metadata)
	}
	if showRecent {
		sections = append(sections, formatRecentSessionsSection(info.RecentSessions))
	}
	return strings.Join(sections, "\n\n"), panel.DefaultWidth
}

// formatMetadataSection builds the key-value metadata rows (Agent, Session,
// Subject, Model, Workspaces). Returns empty string when no fields are set.
func formatMetadataSection(info sessionHeaderInfo) string {
	var lines []string

	if info.AgentName != "" {
		lines = append(lines, formatHeaderRow("Agent", info.AgentName))
	}
	if info.SessionID != "" {
		lines = append(lines, formatHeaderRow("Session", info.SessionID))
	}
	if info.Subject != "" {
		lines = append(lines, formatHeaderRow("Subject", info.Subject))
	}
	if info.Model != "" {
		lines = append(lines, formatHeaderRow("Model", info.Model))
	}
	if len(info.Workspaces) > 0 {
		lines = append(lines, formatHeaderRow("Workspaces", info.Workspaces[0]))
		indent := strings.Repeat(" ", labelWidth)
		for _, ws := range info.Workspaces[1:] {
			lines = append(lines, indent+ws)
		}
	}

	return strings.Join(lines, "\n")
}

// maxRecentSessions caps the number of recent sessions displayed in the
// welcome header to keep the panel height bounded.
const maxRecentSessions = 3

// formatRecentSessionsSection renders the "Recent sessions" block with
// two-line entries: subject + timestamp on line 1, └ connector + session ID
// (dimmed) on line 2. A resume hint is appended at the end.
func formatRecentSessionsSection(sessions []recentSession) string {
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	header := dim.Render("Recent sessions")

	var lines []string
	lines = append(lines, header)

	cap := len(sessions)
	if cap > maxRecentSessions {
		cap = maxRecentSessions
	}
	for _, s := range sessions[:cap] {
		subject := s.Subject
		if subject == "" {
			subject = "(no subject)"
		}
		ts := relativeTime(s.CreatedAt)
		lines = append(lines, fmt.Sprintf("· %-40s %s", subject, dim.Render(ts)))
		lines = append(lines, "  └ "+dim.Render(s.SessionID))
	}

	lines = append(lines, "")
	lines = append(lines, dim.Render("Resume: stigmer resume <session-id>"))

	return strings.Join(lines, "\n")
}

// relativeTime returns a human-readable relative timestamp (e.g., "just now",
// "2 hours ago", "yesterday", "3 days ago"). Pure function with no side effects.
func relativeTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", h)
	case d < 48*time.Hour:
		return "yesterday"
	default:
		days := int(d.Hours() / 24)
		return fmt.Sprintf("%d days ago", days)
	}
}

// formatHeaderRow formats a single label: value row with consistent
// column alignment.
func formatHeaderRow(label, value string) string {
	padded := label + ":" + strings.Repeat(" ", labelWidth-len(label)-1)
	return padded + value
}

// workspaceNames extracts displayable names from workspace entries.
// Uses the Name field which is derived from the user-provided workspace
// path or URL during flag parsing.
func workspaceNames(entries []*sessionv1.WorkspaceEntry) []string {
	if len(entries) == 0 {
		return nil
	}
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.GetName()
	}
	return names
}

// ---------------------------------------------------------------------------
// Side-by-side layout helpers
// ---------------------------------------------------------------------------

// composeSideBySide horizontally joins the metadata block (left) and the
// recent-sessions block (right) with a dim vertical divider between them.
// rightWidth is the visual width allocated to the right column.
func composeSideBySide(metadata string, sessions []recentSession, rightWidth int) string {
	right := formatRecentSessionsForWidth(sessions, rightWidth)

	leftHeight := strings.Count(metadata, "\n") + 1
	rightHeight := strings.Count(right, "\n") + 1
	height := leftHeight
	if rightHeight > height {
		height = rightHeight
	}

	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	bar := dim.Render("│")
	divLines := make([]string, height)
	for i := range divLines {
		divLines[i] = " " + bar + " "
	}
	divider := strings.Join(divLines, "\n")

	return lipgloss.JoinHorizontal(lipgloss.Top, metadata, divider, right)
}

// formatRecentSessionsForWidth renders the "Recent sessions" block
// constrained to the given visual width. Subject names and session IDs
// that exceed the available space are truncated with an ellipsis.
func formatRecentSessionsForWidth(sessions []recentSession, width int) string {
	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	header := dim.Render("Recent sessions")

	var lines []string
	lines = append(lines, header)

	cap := len(sessions)
	if cap > maxRecentSessions {
		cap = maxRecentSessions
	}

	// Pre-compute timestamps to determine the widest one so subject
	// padding is consistent across all entries.
	timestamps := make([]string, cap)
	maxTsWidth := 0
	for i, s := range sessions[:cap] {
		timestamps[i] = relativeTime(s.CreatedAt)
		if w := len(timestamps[i]); w > maxTsWidth {
			maxTsWidth = w
		}
	}

	// subject column = width - "· "(2) - "  "(2) - timestamp
	subjectWidth := width - 4 - maxTsWidth
	if subjectWidth < 10 {
		subjectWidth = 10
	}

	// session-ID prefix "  └ " is 4 visual columns
	maxSidWidth := width - 4
	if maxSidWidth < 10 {
		maxSidWidth = 10
	}

	for i, s := range sessions[:cap] {
		subject := s.Subject
		if subject == "" {
			subject = "(no subject)"
		}
		subject = truncateStr(subject, subjectWidth)
		lines = append(lines, fmt.Sprintf("· %-*s  %s", subjectWidth, subject, dim.Render(timestamps[i])))

		sid := truncateStr(s.SessionID, maxSidWidth)
		lines = append(lines, "  └ "+dim.Render(sid))
	}

	lines = append(lines, "")
	resumeHint := "Resume: stigmer resume <session-id>"
	lines = append(lines, dim.Render(truncateStr(resumeHint, width)))

	return strings.Join(lines, "\n")
}

// truncateStr shortens s to at most maxWidth runes, appending "…" when
// truncation occurs. Returns s unchanged when it fits.
func truncateStr(s string, maxWidth int) string {
	runes := []rune(s)
	if len(runes) <= maxWidth {
		return s
	}
	if maxWidth <= 1 {
		return "…"
	}
	return string(runes[:maxWidth-1]) + "…"
}

// ---------------------------------------------------------------------------
// Terminal width detection and panel width computation
// ---------------------------------------------------------------------------

// terminalWidth returns the current terminal width in columns. Falls back
// to panel.DefaultWidth when stdout is not a terminal (e.g., piped output,
// tests, CI).
func terminalWidth() int {
	w, _, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || w <= 0 {
		return panel.DefaultWidth
	}
	return w
}

// headerPanelWidth computes the optimal panel width for the session header
// given the terminal width. On wide terminals the panel expands (capped at
// maxHeaderPanelWidth) to accommodate the side-by-side layout. On narrow
// terminals it returns panel.DefaultWidth for the stacked layout.
func headerPanelWidth(termWidth int) int {
	// Leave a 2-column margin so the panel doesn't touch the terminal edge.
	w := termWidth - 2
	if w > maxHeaderPanelWidth {
		w = maxHeaderPanelWidth
	}
	if w < panel.DefaultWidth {
		w = panel.DefaultWidth
	}
	return w
}

// maxLineWidth returns the visual width of the widest line in s, measured
// using lipgloss (ANSI-aware).
func maxLineWidth(s string) int {
	best := 0
	for _, line := range strings.Split(s, "\n") {
		if w := lipgloss.Width(line); w > best {
			best = w
		}
	}
	return best
}

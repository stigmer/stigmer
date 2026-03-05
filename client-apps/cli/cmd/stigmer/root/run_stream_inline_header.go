package root

import (
	"fmt"
	"io"
	"strings"
	"time"

	"charm.land/lipgloss/v2"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
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
	// "stigmer run <session-id>". Resumed sessions skip the greeting
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

// renderSessionHeader writes a bordered panel to w summarizing the session
// metadata. Fields that are empty are omitted from the output. At minimum,
// SessionID should be populated; the function gracefully handles all fields
// being empty.
//
// Example output:
//
//	╭─ Stigmer ──────────────────────────────────────────────────────────╮
//	│                                                                    │
//	│  Agent:      mcp-server-creator                                    │
//	│  Session:    ses-01kjv9j3zdvdwh1kpehe5gvs78                        │
//	│  Model:      sonnet-4.6                                            │
//	│  Workspaces: /Users/suresh/scm/github.com/plantonhq/mcp-server    │
//	│              /Users/suresh/scm/github.com/plantonhq/agent-fleet    │
//	│                                                                    │
//	╰────────────────────────────────────────────────────────────────────╯
func renderSessionHeader(w io.Writer, info sessionHeaderInfo) {
	content := formatSessionHeaderContent(info)
	if content == "" {
		return
	}

	output := panel.Render(content, panel.Options{
		Title: headerTitle(info.Version, false),
		Style: panel.StyleBrand,
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
// panel. The content is organized into visual sections separated by blank
// lines:
//
//  1. Greeting — "Welcome back!" (bold), new sessions only
//  2. Metadata — Agent, Session, Subject, Model, Workspaces key-value rows
//  3. Recent sessions — up to 3 entries with session IDs, new sessions only
func formatSessionHeaderContent(info sessionHeaderInfo) string {
	metadata := formatMetadataSection(info)
	hasContent := metadata != "" || len(info.RecentSessions) > 0

	if !hasContent {
		return ""
	}

	var sections []string

	if !info.IsResumed {
		greeting := lipgloss.NewStyle().Bold(true).Render("Welcome back!")
		sections = append(sections, greeting)
	}

	if metadata != "" {
		sections = append(sections, metadata)
	}

	if !info.IsResumed && len(info.RecentSessions) > 0 {
		sections = append(sections, formatRecentSessionsSection(info.RecentSessions))
	}

	return strings.Join(sections, "\n\n")
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
	lines = append(lines, dim.Render("Resume: stigmer run <session-id>"))

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

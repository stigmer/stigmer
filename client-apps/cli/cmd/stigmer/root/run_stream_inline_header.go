package root

import (
	"fmt"
	"io"
	"strings"

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
	Workspaces []string
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
		Title: "Stigmer",
		Style: panel.StyleDefault,
	})
	fmt.Fprintf(w, "%s\n\n", output)
}

// formatSessionHeaderContent builds the key-value content string for the
// session header panel. Each populated field becomes a row; the first
// workspace value is placed on the same line as the "Workspaces:" label,
// subsequent workspaces are indented to align with the first.
func formatSessionHeaderContent(info sessionHeaderInfo) string {
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

package toolrender

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/pmezard/go-difflib/difflib"
)

// diffContextLines is the number of unchanged lines shown around each change
// hunk in the unified diff output. Matches the git diff default of 3.
const diffContextLines = 3

// Styles for unified diff rendering.
var (
	diffAddedStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	diffRemovedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	diffHunkStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Bold(true)
	diffContextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
)

// FormatDiff computes a unified diff between oldText and newText and returns
// an ANSI-styled string suitable for the expanded approval view. Removed
// lines are red, added lines are green, context lines are dim, and hunk
// markers (@@) are dim-bold.
//
// Returns an empty string when the texts are identical (no changes to show).
// Falls back to returning newText unstyled if the diff computation fails.
//
// The --- / +++ file headers are omitted because the file path is already
// displayed in the tool call header above the diff content.
func FormatDiff(oldText, newText string) string {
	if oldText == newText {
		return ""
	}

	diff, err := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{
		A:        difflib.SplitLines(oldText),
		B:        difflib.SplitLines(newText),
		Context:  diffContextLines,
		FromFile: "",
		ToFile:   "",
	})
	if err != nil {
		return newText
	}
	if diff == "" {
		return ""
	}

	return styleDiffLines(diff)
}

// FormatDiffPreview computes a unified diff and returns a styled preview for
// the collapsed post-decision approval result. Each line is indented with 4
// spaces and colored by diff type (red for removed, green for added, dim for
// context/hunk). At most maxLines lines are shown; excess lines produce a
// "... +N more lines" footer.
//
// Returns an empty string when the texts are identical or when the diff
// produces no output.
func FormatDiffPreview(oldText, newText string, maxLines int) string {
	if oldText == newText {
		return ""
	}

	diff, err := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{
		A:        difflib.SplitLines(oldText),
		B:        difflib.SplitLines(newText),
		Context:  diffContextLines,
		FromFile: "",
		ToFile:   "",
	})
	if err != nil || diff == "" {
		return ""
	}

	lines := filterDiffLines(diff)
	if len(lines) == 0 {
		return ""
	}

	showAll := len(lines) <= maxLines+1
	visibleCount := len(lines)
	if !showAll {
		visibleCount = maxLines
	}

	var b strings.Builder
	for i := 0; i < visibleCount; i++ {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(styleDiffPreviewLine("    "+lines[i].text, lines[i].kind))
	}
	if !showAll {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(
			fmt.Sprintf("    … +%d more lines", len(lines)-visibleCount),
		))
	}
	return b.String()
}

// IsEditTool reports whether toolName represents a file edit tool
// (search-and-replace). Derived from toolDisplayMap entries whose label is
// "Edit". This is distinct from IsWriteOrEditTool which includes write/create.
func IsEditTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Edit"
}

// IsWriteTool reports whether toolName represents a file write tool
// (full-content write or create). Derived from toolDisplayMap entries whose
// label is "Write" or "Create".
func IsWriteTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && (info.label == "Write" || info.label == "Create")
}

// IsCreateTool reports whether toolName represents a file creation tool.
// Derived from toolDisplayMap entries whose label is "Create". Create tools
// target new files, so diff computation against existing content is skipped.
func IsCreateTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Create"
}

// ToolFilePath extracts the file path from a tool call's arguments using the
// primaryField and fallbackFields defined in toolDisplayMap. Returns an empty
// string for unknown tools or when no path argument is present.
func ToolFilePath(tc ToolCallInfo) string {
	info, ok := toolDisplayMap[tc.Name]
	if !ok {
		return ""
	}
	return extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type diffLineKind int

const (
	diffKindContext diffLineKind = iota
	diffKindAdded
	diffKindRemoved
	diffKindHunk
)

type diffLine struct {
	kind diffLineKind
	text string
}

// filterDiffLines parses the raw unified diff output into typed lines,
// skipping the --- / +++ file headers and any trailing empty line.
func filterDiffLines(diff string) []diffLine {
	raw := strings.Split(strings.TrimRight(diff, "\n"), "\n")
	lines := make([]diffLine, 0, len(raw))
	for _, line := range raw {
		switch {
		case strings.HasPrefix(line, "---"), strings.HasPrefix(line, "+++"):
			continue
		case strings.HasPrefix(line, "@@"):
			lines = append(lines, diffLine{kind: diffKindHunk, text: line})
		case strings.HasPrefix(line, "-"):
			lines = append(lines, diffLine{kind: diffKindRemoved, text: line})
		case strings.HasPrefix(line, "+"):
			lines = append(lines, diffLine{kind: diffKindAdded, text: line})
		default:
			lines = append(lines, diffLine{kind: diffKindContext, text: line})
		}
	}
	return lines
}

// styleDiffLines parses a raw unified diff string and returns the styled
// version with ANSI colors applied per line type.
func styleDiffLines(diff string) string {
	lines := filterDiffLines(diff)
	if len(lines) == 0 {
		return ""
	}

	var b strings.Builder
	for i, dl := range lines {
		if i > 0 {
			b.WriteByte('\n')
		}
		switch dl.kind {
		case diffKindAdded:
			b.WriteString(diffAddedStyle.Render(dl.text))
		case diffKindRemoved:
			b.WriteString(diffRemovedStyle.Render(dl.text))
		case diffKindHunk:
			b.WriteString(diffHunkStyle.Render(dl.text))
		default:
			b.WriteString(diffContextStyle.Render(dl.text))
		}
	}
	return b.String()
}

// styleDiffPreviewLine applies the appropriate style for a single diff
// preview line. The line already includes the indent prefix.
func styleDiffPreviewLine(line string, kind diffLineKind) string {
	switch kind {
	case diffKindAdded:
		return diffAddedStyle.Render(line)
	case diffKindRemoved:
		return diffRemovedStyle.Render(line)
	case diffKindHunk:
		return diffHunkStyle.Render(line)
	default:
		return dimStyle.Render(line)
	}
}

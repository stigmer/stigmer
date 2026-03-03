package toolrender

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// maxVisibleInGroup is the maximum number of file entries shown in a read
// group before truncation. When total count <= maxVisibleInGroup + 1, all
// entries are shown to avoid a pointless "+ 1 more" footer.
const maxVisibleInGroup = 3

// bulletStyle is the green bullet prefix used in compact tool rendering.
// Matches the visual language of Claude Code's tool call output.
var bulletStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))

// CompactOptions configures compact tool rendering. Created once per renderer
// lifecycle and passed to RenderCompact on each call — no environment reads
// happen inside formatting functions.
type CompactOptions struct {
	// HyperlinksEnabled controls whether file paths are wrapped in OSC 8
	// terminal hyperlinks. Callers should query HyperlinksEnabled(w) once
	// at initialization and store the result here.
	HyperlinksEnabled bool

	// WorkingDir is the directory used to resolve relative file paths into
	// absolute paths for file:// hyperlinks. When empty, paths are used
	// as-is (hyperlinks still work for absolute paths).
	WorkingDir string
}

// RenderCompact returns a compact display of a completed tool call. For tools
// with a compact implementation (currently: read), this produces a terse
// two-line format (header + result summary). For tools not yet converted,
// falls back to RenderWithBadge with the tool's status badge.
//
// Examples:
//
//	"● Read(main.go)\n    Read 125 lines"
//	"● Read(missing.go)\n    ✗ file not found"
//	"  📝 Write: SKILL.md (11.0 KB, 384 lines) ✓"   (fallback)
func RenderCompact(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if known && info.label == "Read" {
		return renderCompactRead(tc, info, opts)
	}
	return RenderWithBadge(tc, StateBadge(tc.Status))
}

// IsReadTool reports whether toolName represents a file read tool.
// Derived from toolDisplayMap entries whose label is "Read".
func IsReadTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Read"
}

// renderCompactRead produces a two-line compact display for a read tool call:
//
//	● Read(path/to/file.go)          <- line 1: header with clickable path
//	    Read 125 lines               <- line 2: dim result summary
//
// Failed reads show the error instead of a line count:
//
//	● Read(path/to/missing.go)
//	    ✗ file not found
func renderCompactRead(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	displayPath := buildHyperlinkedPath(path, opts)
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render("Read"), displayPath)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, 60))
	}

	lineCount := countLines(tc.Result)
	return header + "\n" + dimStyle.Render("    Read "+formatLineCount(lineCount))
}

// RenderReadGroup returns a compact grouped display for multiple consecutive
// read tool calls. Shows a header with total file count, followed by individual
// file entries (up to maxVisibleInGroup), with a "... +N more" footer when
// truncated. Shows all entries when count <= maxVisibleInGroup + 1 to avoid
// a pointless "+ 1 more" line.
//
// Examples:
//
//	"● Read 3 files\n    main.go (125 lines)\n    config.go (43 lines)\n    util.go (201 lines)"
//	"● Read 6 files\n    main.go (125 lines)\n    ...\n    … +3 more"
//	"● Read 4 files (1 failed)\n    main.go (125 lines)\n    missing.go ✗ not found\n    ..."
func RenderReadGroup(reads []ToolCallInfo, opts CompactOptions) string {
	total := len(reads)

	failCount := 0
	for _, tc := range reads {
		if tc.Status == "failed" || tc.Error != "" {
			failCount++
		}
	}

	header := fmt.Sprintf("%s %s %d files",
		bulletStyle.Render("●"), labelStyle.Render("Read"), total)
	if failCount > 0 {
		header += dimStyle.Render(fmt.Sprintf(" (%d failed)", failCount))
	}

	showAll := total <= maxVisibleInGroup+1
	visibleCount := total
	if !showAll {
		visibleCount = maxVisibleInGroup
	}

	var b strings.Builder
	b.WriteString(header)
	for i := 0; i < visibleCount; i++ {
		b.WriteByte('\n')
		b.WriteString(renderGroupEntry(reads[i], opts))
	}
	if !showAll {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(fmt.Sprintf("    … +%d more", total-visibleCount)))
	}

	return b.String()
}

// renderGroupEntry formats a single file entry within a read group.
// The file path uses normal styling (with optional hyperlink for clickability);
// metadata (line count or error) is dim.
//
//	    main.go (125 lines)
//	    missing.go ✗ file not found
func renderGroupEntry(tc ToolCallInfo, opts CompactOptions) string {
	info := toolDisplayMap[tc.Name]
	path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
	displayPath := buildHyperlinkedPath(path, opts)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return "    " + displayPath + dimStyle.Render(" ✗ "+truncate(errMsg, 50))
	}

	lineCount := countLines(tc.Result)
	return "    " + displayPath + dimStyle.Render(" ("+formatLineCount(lineCount)+")")
}

// buildHyperlinkedPath wraps a file path in an OSC 8 hyperlink when enabled.
// Relative paths are resolved against opts.WorkingDir to produce a valid
// file:// URI.
func buildHyperlinkedPath(path string, opts CompactOptions) string {
	if path == "" {
		return ""
	}
	if !opts.HyperlinksEnabled {
		return path
	}

	absPath := path
	if !filepath.IsAbs(path) && opts.WorkingDir != "" {
		absPath = filepath.Join(opts.WorkingDir, path)
	}
	return FileHyperlink(path, absPath, true)
}

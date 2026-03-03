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

// maxShellOutputLines is the maximum number of command output lines shown
// in a compact shell tool display. When total lines exceed this, the
// remainder is collapsed into a "... +N more lines" footer. When total
// lines <= maxShellOutputLines + 1, all lines are shown to avoid a
// pointless "+ 1 more lines" footer (same smart cutoff as read groups).
const maxShellOutputLines = 3

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
// with a compact implementation (read, write, create, edit, shell), this
// produces a terse format: header + result summary. For tools not yet
// converted, falls back to RenderWithBadge with the tool's status badge.
//
// Examples:
//
//	"● Read(main.go)\n    Read 125 lines"
//	"● Write(config.go)\n    Wrote 45 lines"
//	"● Edit(main.go)\n    Edited 12 lines"
//	"● Shell(go test ./...)\n    ok  pkg/foo  0.5s\n    … +15 more lines"
//	"● Read(missing.go)\n    ✗ file not found"
func RenderCompact(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if known && info.label == "Read" {
		return renderCompactRead(tc, info, opts)
	}
	if known && isWriteOrEditLabel(info.label) {
		return renderCompactWrite(tc, info, opts)
	}
	if known && isShellLabel(info.label) {
		return renderCompactShell(tc, info, opts)
	}
	return RenderWithBadge(tc, StateBadge(tc.Status))
}

// RenderCompactRunning returns a compact single-line display for a running
// tool call. For tools with a compact renderer, this produces a bullet-style
// header with a dim ellipsis suffix. For tools without compact support, falls
// back to RenderWithBadge with the running badge.
//
// Examples:
//
//	"● Write(path/to/file.go) …"   (compact, file tool)
//	"● Shell(go test ./...) …"     (compact, shell tool)
func RenderCompactRunning(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known || !hasCompactRenderer(info) {
		return RenderWithBadge(tc, StateBadge("running"))
	}

	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var displayVal string
	if isShellLabel(info.label) {
		displayVal = truncate(firstLine(primaryVal), 60)
	} else {
		displayVal = buildHyperlinkedPath(primaryVal, opts)
	}

	return fmt.Sprintf("%s %s(%s) %s",
		bulletStyle.Render("●"), labelStyle.Render(info.label),
		displayVal, dimStyle.Render("…"))
}

// IsReadTool reports whether toolName represents a file read tool.
// Derived from toolDisplayMap entries whose label is "Read".
func IsReadTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Read"
}

// IsWriteOrEditTool reports whether toolName represents a file mutation tool
// (write, create, or edit). Derived from toolDisplayMap labels.
func IsWriteOrEditTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	if !ok {
		return false
	}
	return isWriteOrEditLabel(info.label)
}

// isWriteOrEditLabel checks whether a toolDisplayInfo label belongs to the
// write/edit family. Extracted so RenderCompact routing and IsWriteOrEditTool
// share the same predicate.
func isWriteOrEditLabel(label string) bool {
	switch label {
	case "Write", "Create", "Edit":
		return true
	}
	return false
}

// isShellLabel checks whether a toolDisplayInfo label belongs to the shell
// tool family. The toolDisplayMap uses "Shell" for most shell tool names and
// "Execute" for the execute tool name.
func isShellLabel(label string) bool {
	switch label {
	case "Shell", "Execute":
		return true
	}
	return false
}

// hasCompactRenderer reports whether a tool has a compact rendering
// implementation. Used by RenderCompactRunning to decide between compact
// and legacy formats. As new compact renderers are added in Phase 2.4,
// their labels are registered here.
func hasCompactRenderer(info toolDisplayInfo) bool {
	switch info.label {
	case "Read", "Write", "Create", "Edit", "Shell", "Execute":
		return true
	}
	return false
}

// completedVerb maps a tool display label to its past-tense action verb
// for the compact result summary line (e.g., "Wrote 45 lines").
func completedVerb(label string) string {
	switch label {
	case "Write":
		return "Wrote"
	case "Create":
		return "Created"
	case "Edit":
		return "Edited"
	default:
		return label
	}
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

// renderCompactWrite produces a two-line compact display for a write, create,
// or edit tool call:
//
//	● Write(path/to/file.go)         <- line 1: header with clickable path
//	    Wrote 45 lines               <- line 2: dim result summary
//
// Line count is derived from the tool's displayable content (args content for
// write/edit tools via resolveDisplayContent). Failed calls show the error:
//
//	● Write(path/to/file.go)
//	    ✗ permission denied
func renderCompactWrite(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	displayPath := buildHyperlinkedPath(path, opts)
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayPath)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, 60))
	}

	content := resolveDisplayContent(tc, info)
	lineCount := countLines(content)
	verb := completedVerb(info.label)
	return header + "\n" + dimStyle.Render("    "+verb+" "+formatLineCount(lineCount))
}

// renderCompactShell produces a compact display for a shell/execute tool call:
//
//	● Shell(go test ./...)           <- line 1: header with truncated command
//	    ok  pkg/foo  0.5s            <- line 2+: dim output lines (up to 3)
//	    ok  pkg/bar  1.2s
//	    ok  pkg/baz  0.3s
//	    … +15 more lines             <- truncation footer (when > 3 lines)
//
// Commands are truncated to 60 chars in the header for scannability. The full
// command is visible from the AI message in scrollback.
//
// Empty output shows "(no output)". Failed commands show the error:
//
//	● Shell(go build ./...)
//	    ✗ compilation failed
func renderCompactShell(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	command := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
	displayCmd := truncate(firstLine(command), 60)
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayCmd)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, 60))
	}

	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		return header + "\n" + dimStyle.Render("    (no output)")
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	showAll := len(lines) <= maxShellOutputLines+1
	visibleCount := len(lines)
	if !showAll {
		visibleCount = maxShellOutputLines
	}

	var b strings.Builder
	b.WriteString(header)
	for i := 0; i < visibleCount; i++ {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render("    " + lines[i]))
	}
	if !showAll {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(fmt.Sprintf("    … +%d more lines", len(lines)-visibleCount)))
	}

	return b.String()
}

// firstLine returns the first line of s, stripping any trailing newline.
// Used to sanitize commands that may contain embedded newlines before
// rendering them in a single-line header.
func firstLine(s string) string {
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		return s[:idx]
	}
	return s
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

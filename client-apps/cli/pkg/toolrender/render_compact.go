package toolrender

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"charm.land/lipgloss/v2"
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

// maxThinkLines is the maximum number of thought text lines shown in a
// compact think tool display. Uses the same smart cutoff pattern as shell
// output: when total lines <= maxThinkLines + 1, all lines are shown.
const maxThinkLines = 3

// bulletStyle is the green bullet prefix used in compact tool rendering.
// Matches the visual language of Claude Code's tool call output.
var bulletStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))

// BulletGreen renders s with the green bullet style. Exposed for use by
// the inline renderer's sub-agent lifecycle handlers which construct
// headers outside of RenderCompact (from SubAgentStartedEvent, not
// ToolCallInfo).
func BulletGreen(s string) string { return bulletStyle.Render(s) }

// LabelBold renders s with the bold label style used in compact tool
// headers. Exposed for the same reason as BulletGreen.
func LabelBold(s string) string { return labelStyle.Render(s) }

// CompactOptions configures compact tool rendering. Created once per renderer
// lifecycle and passed to RenderCompact on each call — no environment reads
// happen inside formatting functions.
type CompactOptions struct {
	// HyperlinksEnabled controls whether file paths are wrapped in OSC 8
	// terminal hyperlinks. Callers should query HyperlinksEnabled(w) once
	// at initialization and store the result here.
	HyperlinksEnabled bool

	// WorkspaceRoots holds the local absolute paths of workspace directories.
	// Used to resolve relative file paths into absolute paths for file://
	// hyperlinks. In multi-workspace sessions, the first path segment of a
	// relative path is matched against workspace root basenames; unmatched
	// paths fall back to a stat-probe against each root.
	// When empty, relative paths degrade to plain text (no hyperlink).
	WorkspaceRoots []string

	// SandboxRoot is the session's sandbox directory on disk:
	// ~/.stigmer/data/workspace/sessions/<session-id>/
	// Used as a universal fallback for path resolution — covers git clones,
	// symlinked local workspaces, and any other files in the sandbox.
	// Empty when no session is active.
	SandboxRoot string

	// PlatformDir is the session's platform directory on disk:
	// ~/.stigmer/sessions/<session-id>/platform/
	// Used to resolve .stigmer/ virtual-mount paths that the agent emits
	// (e.g., .stigmer/skills/mcp-server-creator/SKILL.md). Empty when no
	// session is active.
	PlatformDir string

	// StatFunc checks whether a path exists on disk. Used by the stat-probe
	// fallback in multi-workspace path resolution. Defaults to os.Stat when
	// nil. Inject a stub for deterministic tests.
	StatFunc func(string) (os.FileInfo, error)
}

// RenderCompact returns a compact display of a completed tool call. Every
// known tool label has a compact renderer; unknown/MCP tools fall back to
// RenderWithBadge. Task tools also fall back — their visual representation
// comes from SubAgentStarted/Completed lifecycle events, not from
// RenderCompact (the inline renderer suppresses Task tool events).
//
// Examples:
//
//	"● Read(main.go)\n    Read 125 lines"
//	"● Write(config.go)\n    Wrote 45 lines"
//	"● Shell(go test ./...)\n    ok  pkg/foo  0.5s\n    … +15 more lines"
//	"● Find(*.go)\n    Found 12 matches"
//	"● Delete(tmp/old.go)\n    Deleted"
//	"● Thinking\n    The user wants to refactor..."
func RenderCompact(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderCompactUnknown(tc, opts)
	}
	switch {
	case info.label == "Read":
		return renderCompactRead(tc, info, opts)
	case isWriteOrEditLabel(info.label):
		return renderCompactWrite(tc, info, opts)
	case isShellLabel(info.label):
		return renderCompactShell(tc, info, opts)
	case isDiscoveryLabel(info.label):
		return renderCompactDiscovery(tc, info, opts)
	case info.label == "Delete":
		return renderCompactDelete(tc, info, opts)
	case info.label == "Thinking":
		return renderCompactThink(tc, info, opts)
	default:
		return RenderWithBadge(tc, StateBadge(tc.Status))
	}
}

// RenderCompactRunning returns a compact single-line display for a running
// tool call. For tools with a compact renderer, this produces a bullet-style
// header with a dim ellipsis suffix. For tools without compact support, falls
// back to RenderWithBadge with the running badge.
//
// Display logic varies by tool category:
//   - Shell: truncated command text
//   - Pattern-based (Find, Search): plain text pattern, not hyperlinked
//   - Path-based (List, Delete, Read, Write, Edit): hyperlinked file path
//   - Label-only (Thinking): no parens, just "● Thinking …"
//
// Examples:
//
//	"● Write(path/to/file.go) …"   (path-based)
//	"● Shell(go test ./...) …"     (command)
//	"● Find(*.go) …"              (pattern-based)
//	"● Thinking …"                (label-only)
func RenderCompactRunning(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderCompactUnknownRunning(tc)
	}
	if !hasCompactRenderer(info) {
		return RenderWithBadge(tc, StateBadge("running"))
	}

	if info.label == "Thinking" {
		return fmt.Sprintf("%s %s %s",
			bulletStyle.Render("●"), labelStyle.Render(info.label),
			dimStyle.Render("…"))
	}

	if info.label == "Sub-agent" {
		desc := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
		if desc == "" {
			desc = "running"
		}
		return fmt.Sprintf("%s %s: %s %s",
			bulletStyle.Render("●"), labelStyle.Render("Sub-agent"),
			truncate(desc, 60), dimStyle.Render("…"))
	}

	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var displayVal string
	switch {
	case isShellLabel(info.label):
		displayVal = truncate(firstLine(primaryVal), 60)
	case isPatternBasedLabel(info.label):
		displayVal = truncate(primaryVal, 60)
	default:
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

// IsThinkTool reports whether toolName represents an agent reasoning tool.
// Derived from toolDisplayMap entries whose label is "Thinking".
func IsThinkTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Thinking"
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

// isDiscoveryLabel checks whether a toolDisplayInfo label belongs to the
// discovery tool family (directory listing, glob, grep).
func isDiscoveryLabel(label string) bool {
	switch label {
	case "List", "Find", "Search":
		return true
	}
	return false
}

// isPatternBasedLabel checks whether a label's primary field is a search
// pattern rather than a file path. Used by RenderCompactRunning to avoid
// wrapping patterns in file:// hyperlinks.
func isPatternBasedLabel(label string) bool {
	return label == "Find" || label == "Search"
}

// hasCompactRenderer reports whether a tool has a compact rendering
// implementation. Used by RenderCompactRunning to decide between compact
// and legacy formats. All known tool labels have compact renderers; only
// unknown/MCP tools fall back to legacy.
func hasCompactRenderer(info toolDisplayInfo) bool {
	switch info.label {
	case "Read", "Write", "Create", "Edit", "Shell", "Execute",
		"List", "Find", "Search", "Delete", "Thinking", "Sub-agent":
		return true
	}
	return false
}

// IsTaskTool reports whether toolName represents a sub-agent task tool.
// Derived from toolDisplayMap entries whose label is "Sub-agent".
func IsTaskTool(toolName string) bool {
	info, ok := toolDisplayMap[toolName]
	return ok && info.label == "Sub-agent"
}

// GutterWidth returns the visible character width of the gutter prefix
// added by GutterWrap. Callers use this to compute the available content
// width after gutter indentation.
func GutterWidth() int { return 4 }

// GutterWrap prepends a dim gutter prefix ("  │ ") to each line of s,
// visually nesting the content under a sub-agent Task header. The pipe
// character uses dimStyle for a subtle visual guide; surrounding spaces
// are unstyled.
func GutterWrap(s string) string {
	if s == "" {
		return ""
	}
	prefix := "  " + dimStyle.Render("│") + " "
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
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

	if errMsg := toolCallError(tc); errMsg != "" {
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
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
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
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
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
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

// renderCompactDiscovery produces a two-line compact display for a discovery
// tool call (List, Find, Search):
//
//	● Find(*.go)
//	    Found 12 matches
//	● List(src/)
//	    15 entries
//
// Empty results show "(no matches)" or "(empty)". Failed calls show the error:
//
//	● Find(*.go)
//	    ✗ no readable directories
func renderCompactDiscovery(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var displayVal string
	if isPatternBasedLabel(info.label) {
		displayVal = truncate(primaryVal, 60)
	} else {
		displayVal = buildHyperlinkedPath(primaryVal, opts)
	}
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayVal)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
	}

	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		empty := "(no matches)"
		if info.label == "List" {
			empty = "(empty)"
		}
		return header + "\n" + dimStyle.Render("    "+empty)
	}

	count := countResultEntries(content)
	return header + "\n" + dimStyle.Render("    "+discoverySummary(info.label, count))
}

// renderCompactDelete produces a two-line compact display for a delete tool call:
//
//	● Delete(tmp/old.go)
//	    Deleted
//
// Failed deletes show the error:
//
//	● Delete(tmp/old.go)
//	    ✗ permission denied
func renderCompactDelete(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	displayPath := buildHyperlinkedPath(path, opts)
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render("Delete"), displayPath)

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
	}

	return header + "\n" + dimStyle.Render("    Deleted")
}

// renderCompactThink produces a compact display for a think tool call:
//
//	● Thinking
//	    The user wants to refactor the module structure.
//	    I should consider the existing patterns in the
//	    codebase before making changes.
//	    … +5 more lines
//
// Thought text is extracted directly from the "thought" arg. Unlike other
// renderers, this intentionally bypasses resolveDisplayContent — the think
// tool's tc.Result is a meaningless acknowledgment ("ok"), not content
// worth displaying. Up to maxThinkLines are shown, with the same smart
// cutoff as shell output.
//
// Empty thoughts show "(no content)". Failed calls show the error.
func renderCompactThink(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	header := fmt.Sprintf("%s %s", bulletStyle.Render("●"), labelStyle.Render("Thinking"))

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, maxErrorDisplayLen))
	}

	content := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
	if content == "" || strings.TrimSpace(content) == "" {
		return header + "\n" + dimStyle.Render("    (no content)")
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	showAll := len(lines) <= maxThinkLines+1
	visibleCount := len(lines)
	if !showAll {
		visibleCount = maxThinkLines
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

// maxUnknownOutputLines is the maximum number of result output lines shown
// in a compact unknown/MCP tool display. Uses the same smart cutoff pattern
// as shell output: when total lines <= maxUnknownOutputLines + 1, all lines
// are shown.
const maxUnknownOutputLines = 3

// renderCompactUnknown produces a compact display for unknown/MCP tool calls.
// Uses the same visual language as built-in compact renderers — green bullet,
// bold tool name, dim metadata, input args, and output preview:
//
//	● search (1.6 KB, 1.6s)
//	    query: "planton mcp server"
//	    Found 8 definition(s) matching "planton mcp server"
//	    … +22 more lines
//
// Error case (error embedded in result):
//
//	● get_mcp_server (521 chars, 196ms)
//	    org: "default"
//	    ✗ MCP server "planton" not found...
//
// With server identity (Phase 2, when tc.ServerName is populated):
//
//	● planton/search (1.6 KB, 1.6s)
//	    query: "planton mcp server"
//	    Found 8 definition(s) matching...
func renderCompactUnknown(tc ToolCallInfo, opts CompactOptions) string {
	header := buildUnknownCompactHeader(tc)

	if errMsg := toolCallError(tc); errMsg != "" {
		return buildUnknownWithError(header, tc.Args, errMsg)
	}

	return buildUnknownWithResult(header, tc)
}

// buildUnknownCompactHeader produces the first line: bullet, tool name, and
// metadata suffix. When ServerName is populated (Phase 2), the header shows
// "● server/tool (metadata)".
func buildUnknownCompactHeader(tc ToolCallInfo) string {
	name := tc.Name
	if tc.ServerName != "" {
		name = tc.ServerName + "/" + tc.Name
	}

	header := fmt.Sprintf("%s %s", bulletStyle.Render("●"), labelStyle.Render(name))

	suffix := renderSuffix(tc)
	if suffix != "" {
		header += " " + dimStyle.Render(suffix)
	}

	if badge := StateBadge(tc.Status); badge != "" {
		header += " " + dimStyle.Render(badge)
	}
	return header
}

// buildUnknownWithError assembles the compact unknown tool display when an
// error is detected. Shows input args followed by the error message.
func buildUnknownWithError(header string, args map[string]interface{}, errMsg string) string {
	var b strings.Builder
	b.WriteString(header)

	if inputLines := formatInputArgs(args, maxInputArgs); inputLines != "" {
		b.WriteByte('\n')
		b.WriteString(inputLines)
	}

	b.WriteByte('\n')
	b.WriteString(dimStyle.Render("    ✗ " + truncate(errMsg, maxErrorDisplayLen)))
	return b.String()
}

// buildUnknownWithResult assembles the compact unknown tool display for a
// successful (or in-progress) tool call. Shows input args followed by up to
// maxUnknownOutputLines of result content.
func buildUnknownWithResult(header string, tc ToolCallInfo) string {
	var b strings.Builder
	b.WriteString(header)

	if inputLines := formatInputArgs(tc.Args, maxInputArgs); inputLines != "" {
		b.WriteByte('\n')
		b.WriteString(inputLines)
	}

	result := strings.TrimSpace(tc.Result)
	if result == "" {
		return b.String()
	}

	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	showAll := len(lines) <= maxUnknownOutputLines+1
	visibleCount := len(lines)
	if !showAll {
		visibleCount = maxUnknownOutputLines
	}

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

// renderCompactUnknownRunning produces a single-line running indicator for
// unknown/MCP tools. Matches the compact running style of built-in tools.
//
// Examples:
//
//	"● search …"
//	"● planton/get_mcp_server …"
func renderCompactUnknownRunning(tc ToolCallInfo) string {
	name := tc.Name
	if tc.ServerName != "" {
		name = tc.ServerName + "/" + tc.Name
	}
	return fmt.Sprintf("%s %s %s",
		bulletStyle.Render("●"), labelStyle.Render(name),
		dimStyle.Render("…"))
}

// countResultEntries counts non-empty lines in a discovery tool result.
// Unlike countLines (designed for file content where trailing newlines
// matter), this counts actual result entries — appropriate for directory
// listings, glob matches, and search results.
func countResultEntries(s string) int {
	if s == "" {
		return 0
	}
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	count := 0
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

// discoverySummary maps a discovery tool label and result count to a
// human-readable summary line.
func discoverySummary(label string, count int) string {
	switch label {
	case "List":
		if count == 1 {
			return "1 entry"
		}
		return fmt.Sprintf("%d entries", count)
	default:
		if count == 1 {
			return "Found 1 match"
		}
		return fmt.Sprintf("Found %d matches", count)
	}
}

// maxErrorDisplayLen is the maximum character length for error messages in
// compact tool displays. Error text exceeding this length is truncated with
// "..." by truncate(). Used by isErrorExpandable to determine whether
// expanding would reveal more error content.
const maxErrorDisplayLen = 60

// resultErrorPrefix is the prefix the backend's enrich_error_message uses to
// mark tool results that contain error information. When a tool catches an
// exception, the Python worker returns the error as a result string starting
// with this prefix while leaving status as TOOL_CALL_COMPLETED and error empty.
const resultErrorPrefix = "Error: "

// toolCallError returns the error message for a tool call, checking three
// sources in priority order:
//  1. tc.Error (explicit error field from proto)
//  2. tc.Status == "failed" (status without error message)
//  3. tc.Result starts with "Error: " (backend embeds errors in result)
//
// Returns empty string if no error is detected.
func toolCallError(tc ToolCallInfo) string {
	if tc.Error != "" {
		return tc.Error
	}
	if tc.Status == "failed" {
		return "failed"
	}
	if msg := extractResultError(tc.Result); msg != "" {
		return msg
	}
	return ""
}

// extractResultError checks if a tool result contains an embedded error
// message (prefixed with "Error: "). Returns the first line of the error
// (without prefix), or empty string if no error detected.
func extractResultError(result string) string {
	if !strings.HasPrefix(result, resultErrorPrefix) {
		return ""
	}
	msg := result[len(resultErrorPrefix):]
	if idx := strings.IndexByte(msg, '\n'); idx >= 0 {
		msg = msg[:idx]
	}
	return msg
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
		if toolCallError(tc) != "" {
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
//	main.go (125 lines)
//	missing.go ✗ file not found
func renderGroupEntry(tc ToolCallInfo, opts CompactOptions) string {
	info := toolDisplayMap[tc.Name]
	path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
	displayPath := buildHyperlinkedPath(path, opts)

	if errMsg := toolCallError(tc); errMsg != "" {
		return "    " + displayPath + dimStyle.Render(" ✗ "+truncate(errMsg, 50))
	}

	lineCount := countLines(tc.Result)
	return "    " + displayPath + dimStyle.Render(" ("+formatLineCount(lineCount)+")")
}

// buildHyperlinkedPath wraps a file path in an OSC 8 hyperlink when enabled.
// Relative paths are resolved against WorkspaceRoots, PlatformDir (.stigmer/
// virtual mount), and SandboxRoot (universal fallback). Unresolvable relative
// paths degrade to plain text (no hyperlink) to avoid malformed file:// URIs
// where the first path segment would be misinterpreted as a hostname.
func buildHyperlinkedPath(path string, opts CompactOptions) string {
	if path == "" {
		return ""
	}
	if !opts.HyperlinksEnabled {
		return path
	}

	absPath := path
	if !filepath.IsAbs(path) {
		resolved := resolveWorkspacePath(path, opts)
		if resolved == "" {
			return path
		}
		absPath = resolved
	}
	return FileHyperlink(path, absPath, true)
}

// ResolveFilePath resolves a tool's file path to an absolute filesystem path
// using workspace roots, platform dir, and sandbox root. Returns the absolute
// path when resolution succeeds, or empty string on failure. For paths that
// are already absolute, returns them unchanged.
//
// This is the public interface to the workspace path resolution strategy,
// used by the TUI layer for reading existing file content (e.g., for diff
// computation on write tools).
func ResolveFilePath(path string, opts CompactOptions) string {
	if path == "" {
		return ""
	}
	if filepath.IsAbs(path) {
		return path
	}
	return resolveWorkspacePath(path, opts)
}

// resolveWorkspacePath resolves a relative path to an absolute filesystem path
// using a layered strategy:
//
//  1. .stigmer/ virtual mount — paths prefixed with ".stigmer/" are stripped
//     and joined with PlatformDir (the session's platform directory).
//  2. Workspace roots (local) — basename-match + stat-probe against user's
//     local workspace paths. Preferred because they resolve to the user's
//     real path (not a symlink).
//  3. Sandbox root — universal fallback that covers git clones, symlinked
//     local paths, and any other files in the session sandbox.
//
// Each layer uses a stat-probe to verify the candidate exists on disk.
// Returns empty string when all strategies fail (graceful degradation).
func resolveWorkspacePath(relPath string, opts CompactOptions) string {
	if opts.PlatformDir != "" {
		if stripped, ok := strings.CutPrefix(filepath.ToSlash(relPath), ".stigmer/"); ok {
			candidate := filepath.Join(opts.PlatformDir, stripped)
			if statProbe(candidate, opts.StatFunc) {
				return candidate
			}
		}
	}

	if resolved := resolveAgainstWorkspaceRoots(relPath, opts.WorkspaceRoots, opts.StatFunc); resolved != "" {
		return resolved
	}

	if opts.SandboxRoot != "" {
		candidate := filepath.Join(opts.SandboxRoot, relPath)
		if statProbe(candidate, opts.StatFunc) {
			return candidate
		}
	}

	return ""
}

// resolveAgainstWorkspaceRoots resolves a relative path against local workspace
// roots. With a single root, the path is joined directly. With multiple roots,
// the first path segment is matched against each root's basename; unmatched
// paths fall back to a stat-probe against each root.
func resolveAgainstWorkspaceRoots(relPath string, roots []string, statFn func(string) (os.FileInfo, error)) string {
	if len(roots) == 0 {
		return ""
	}

	if len(roots) == 1 {
		return filepath.Join(roots[0], relPath)
	}

	parts := strings.SplitN(filepath.ToSlash(relPath), "/", 2)
	firstSeg := parts[0]
	for _, root := range roots {
		if filepath.Base(root) == firstSeg {
			if len(parts) > 1 {
				return filepath.Join(root, parts[1])
			}
			return root
		}
	}

	if statFn == nil {
		statFn = os.Stat
	}
	for _, root := range roots {
		candidate := filepath.Join(root, relPath)
		if _, err := statFn(candidate); err == nil {
			return candidate
		}
	}

	return ""
}

// statProbe checks whether a path exists on disk. Uses statFn when non-nil,
// defaulting to os.Stat. Used by the new resolution layers (PlatformDir,
// SandboxRoot) where a stat-probe is always required.
func statProbe(path string, statFn func(string) (os.FileInfo, error)) bool {
	if statFn == nil {
		statFn = os.Stat
	}
	_, err := statFn(path)
	return err == nil
}

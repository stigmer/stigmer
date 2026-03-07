package toolrender

import (
	"fmt"
	"strings"
)

// RenderExpanded returns an expanded display of a completed tool call.
// Same visual language as RenderCompact — green bullet, bold label, dim
// metadata — but with all truncation limits removed. For errors, shows
// the full error text instead of the 60-char truncated compact version.
//
// Used by the re-commit path when the user toggles expanded mode.
func RenderExpanded(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderExpandedUnknown(tc, opts)
	}
	switch {
	case info.label == "Read":
		return renderExpandedRead(tc, info, opts)
	case isWriteOrEditLabel(info.label):
		return renderExpandedWrite(tc, info, opts)
	case isShellLabel(info.label):
		return renderExpandedShell(tc, info, opts)
	case isDiscoveryLabel(info.label):
		return renderExpandedDiscovery(tc, info, opts)
	case info.label == "Delete":
		return renderExpandedDelete(tc, info, opts)
	case info.label == "Thinking":
		return renderExpandedThink(tc, info, opts)
	default:
		return RenderWithBadge(tc, StateBadge(tc.Status))
	}
}

// RenderReadGroupExpanded returns an expanded grouped display for multiple
// consecutive read tool calls. Unlike RenderReadGroup which caps visible
// entries at maxVisibleInGroup, the expanded variant shows ALL entries.
// Entry format is unchanged: hyperlinked path + line count or error.
//
// Examples:
//
//	"● Read 8 files\n    main.go (125 lines)\n    ...\n    util.go (43 lines)"
//	"● Read 5 files (1 failed)\n    main.go (125 lines)\n    missing.go ✗ not found\n    ..."
func RenderReadGroupExpanded(reads []ToolCallInfo, opts CompactOptions) string {
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

	var b strings.Builder
	b.WriteString(header)
	for i := 0; i < total; i++ {
		b.WriteByte('\n')
		b.WriteString(renderGroupEntry(reads[i], opts))
	}

	return b.String()
}

// ---------------------------------------------------------------------------
// Expanded error rendering
// ---------------------------------------------------------------------------

// renderExpandedErrorContent returns the error body lines for an expanded
// error display, without truncation. The first line carries the ✗ indicator.
//
// Three sources are checked in priority order:
//  1. Result-prefixed errors ("Error: ..."): all result lines are shown, with
//     the "Error: " prefix stripped from the first line (✗ replaces it).
//  2. Explicit error field: the full tc.Error is shown (multi-line supported).
//  3. Status-only failure: shows "✗ failed" (same as compact — no extra content).
func renderExpandedErrorContent(tc ToolCallInfo) string {
	if strings.HasPrefix(tc.Result, resultErrorPrefix) {
		result := strings.TrimSpace(tc.Result)
		lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
		var b strings.Builder
		for i, line := range lines {
			if i > 0 {
				b.WriteByte('\n')
			}
			if i == 0 {
				b.WriteString(dimStyle.Render("    ✗ " + line[len(resultErrorPrefix):]))
			} else {
				b.WriteString(dimStyle.Render("    " + line))
			}
		}
		return b.String()
	}

	if tc.Error != "" {
		lines := strings.Split(strings.TrimRight(tc.Error, "\n"), "\n")
		var b strings.Builder
		for i, line := range lines {
			if i > 0 {
				b.WriteByte('\n')
			}
			if i == 0 {
				b.WriteString(dimStyle.Render("    ✗ " + line))
			} else {
				b.WriteString(dimStyle.Render("    " + line))
			}
		}
		return b.String()
	}

	return dimStyle.Render("    ✗ failed")
}

// ---------------------------------------------------------------------------
// Per-tool expanded renderers
// ---------------------------------------------------------------------------

// renderExpandedRead produces an expanded display for a read tool call.
// Non-error output is identical to compact (line count + clickable path).
// For expandable errors, shows the full error text without truncation.
func renderExpandedRead(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	if errMsg := toolCallError(tc); errMsg != "" && isErrorExpandable(tc) {
		path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
		displayPath := buildHyperlinkedPath(path, opts)
		header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render("Read"), displayPath)
		return header + "\n" + renderExpandedErrorContent(tc)
	}
	return renderCompactRead(tc, info, opts)
}

// renderExpandedWrite produces an expanded display for a write/edit tool call.
// Non-error output is identical to compact (line count + clickable path).
// For expandable errors, shows the full error text without truncation.
func renderExpandedWrite(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	if (tc.Status == "failed" || tc.Error != "") && isErrorExpandable(tc) {
		path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
		displayPath := buildHyperlinkedPath(path, opts)
		header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayPath)
		return header + "\n" + renderExpandedErrorContent(tc)
	}
	return renderCompactWrite(tc, info, opts)
}

// renderExpandedDelete produces an expanded display for a delete tool call.
// Non-error output is identical to compact. For expandable errors, shows
// the full error text without truncation.
func renderExpandedDelete(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	if (tc.Status == "failed" || tc.Error != "") && isErrorExpandable(tc) {
		path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
		displayPath := buildHyperlinkedPath(path, opts)
		header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render("Delete"), displayPath)
		return header + "\n" + renderExpandedErrorContent(tc)
	}
	return renderCompactDelete(tc, info, opts)
}

// renderExpandedShell produces an expanded display for a shell/execute tool
// call. Same header as compact (truncated command + bold label). Differs by
// showing ALL output lines with no maxShellOutputLines cap and full error
// text without truncation.
func renderExpandedShell(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	command := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
	displayCmd := truncate(firstLine(command), 60)
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayCmd)

	if tc.Status == "failed" || tc.Error != "" {
		return header + "\n" + renderExpandedErrorContent(tc)
	}

	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		return header + "\n" + dimStyle.Render("    (no output)")
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	var b strings.Builder
	b.WriteString(header)
	for _, line := range lines {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render("    " + line))
	}

	return b.String()
}

// renderExpandedThink produces an expanded display for a think tool call.
// Same header as compact ("● Thinking"). Differs by showing ALL thought
// lines with no maxThinkLines cap and full error text without truncation.
func renderExpandedThink(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	header := fmt.Sprintf("%s %s", bulletStyle.Render("●"), labelStyle.Render("Thinking"))

	if tc.Status == "failed" || tc.Error != "" {
		return header + "\n" + renderExpandedErrorContent(tc)
	}

	content := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
	if content == "" || strings.TrimSpace(content) == "" {
		return header + "\n" + dimStyle.Render("    (no content)")
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	var b strings.Builder
	b.WriteString(header)
	for _, line := range lines {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render("    " + line))
	}

	return b.String()
}

// renderExpandedDiscovery produces an expanded display for a discovery tool
// call (List, Find, Search). Compact mode shows only a count summary
// ("Found 12 matches"); expanded mode shows all result entries. Errors
// show full text without truncation.
func renderExpandedDiscovery(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var displayVal string
	if isPatternBasedLabel(info.label) {
		displayVal = truncate(primaryVal, 60)
	} else {
		displayVal = buildHyperlinkedPath(primaryVal, opts)
	}
	header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayVal)

	if tc.Status == "failed" || tc.Error != "" {
		return header + "\n" + renderExpandedErrorContent(tc)
	}

	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		empty := "(no matches)"
		if info.label == "List" {
			empty = "(empty)"
		}
		return header + "\n" + dimStyle.Render("    "+empty)
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	var b strings.Builder
	b.WriteString(header)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			b.WriteByte('\n')
			b.WriteString(dimStyle.Render("    " + trimmed))
		}
	}

	return b.String()
}

// renderExpandedUnknown produces an expanded display for unknown/MCP tool
// calls. Same header and input args as compact. Differs by showing ALL
// result lines with no maxUnknownOutputLines cap and full error text
// without truncation.
func renderExpandedUnknown(tc ToolCallInfo, opts CompactOptions) string {
	header := buildUnknownCompactHeader(tc)

	if toolCallError(tc) != "" {
		var b strings.Builder
		b.WriteString(header)
		if inputLines := formatInputArgs(tc.Args, maxInputArgs); inputLines != "" {
			b.WriteByte('\n')
			b.WriteString(inputLines)
		}
		b.WriteByte('\n')
		b.WriteString(renderExpandedErrorContent(tc))
		return b.String()
	}

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
	for _, line := range lines {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render("    " + line))
	}

	return b.String()
}

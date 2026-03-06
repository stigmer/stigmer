package toolrender

import (
	"fmt"
	"strings"
)

// RenderExpanded returns an expanded display of a completed tool call.
// Same visual language as RenderCompact — green bullet, bold label, dim
// metadata — but with all truncation limits removed. Tools that have no
// truncation in compact mode (read, write, delete) delegate directly to
// their compact renderers; the output is identical.
//
// Used by the re-commit path when the user toggles expanded mode.
func RenderExpanded(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderExpandedUnknown(tc, opts)
	}
	switch {
	case info.label == "Read":
		return renderCompactRead(tc, info, opts)
	case isWriteOrEditLabel(info.label):
		return renderCompactWrite(tc, info, opts)
	case isShellLabel(info.label):
		return renderExpandedShell(tc, info, opts)
	case isDiscoveryLabel(info.label):
		return renderExpandedDiscovery(tc, info, opts)
	case info.label == "Delete":
		return renderCompactDelete(tc, info, opts)
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

// renderExpandedShell produces an expanded display for a shell/execute tool
// call. Same header as compact (truncated command + bold label). Differs by
// showing ALL output lines with no maxShellOutputLines cap.
//
// Error, empty-output, and header rendering are identical to compact.
func renderExpandedShell(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
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
// lines with no maxThinkLines cap.
//
// Error and empty-content handling are identical to compact.
func renderExpandedThink(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
	header := fmt.Sprintf("%s %s", bulletStyle.Render("●"), labelStyle.Render("Thinking"))

	if tc.Status == "failed" || tc.Error != "" {
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, 60))
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
// ("Found 12 matches"); expanded mode shows all result entries.
//
// Error and empty-result handling are identical to compact.
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
		errMsg := tc.Error
		if errMsg == "" {
			errMsg = "failed"
		}
		return header + "\n" + dimStyle.Render("    ✗ "+truncate(errMsg, 60))
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
// result lines with no maxUnknownOutputLines cap.
func renderExpandedUnknown(tc ToolCallInfo, opts CompactOptions) string {
	header := buildUnknownCompactHeader(tc)

	if errMsg := toolCallError(tc); errMsg != "" {
		return buildUnknownWithError(header, tc.Args, errMsg)
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

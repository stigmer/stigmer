package toolrender

import "strings"

// IsExpandable reports whether the expanded rendering of tc would show
// more content than the compact rendering. Used by the inline renderer
// to decide whether to display the "(ctrl+o to expand)" hint.
//
// Tools whose compact and expanded renderers produce identical output
// (Read, Write, Edit, Create, Delete) return true only when a truncated
// error is detected — expanding reveals the full error text. Tools that
// truncate content in compact mode (Shell, Thinking, Discovery,
// Unknown/MCP) return true when content exceeds the truncation threshold
// OR when an error message is truncated.
func IsExpandable(tc ToolCallInfo) bool {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return isUnknownExpandable(tc)
	}
	switch {
	case info.label == "Read":
		return isErrorExpandable(tc)
	case isWriteOrEditLabel(info.label):
		return isErrorExpandable(tc)
	case info.label == "Delete":
		return isErrorExpandable(tc)
	case isShellLabel(info.label):
		return isContentExpandable(tc, info, maxShellOutputLines)
	case isDiscoveryLabel(info.label):
		return isDiscoveryExpandable(tc, info)
	case info.label == "Thinking":
		return isThinkExpandable(tc, info)
	default:
		return isErrorExpandable(tc)
	}
}

// IsReadGroupExpandable reports whether a read group has more entries
// than the compact renderer shows. The compact read group displays up
// to maxVisibleInGroup entries (with a smart cutoff: all entries are
// shown when total <= maxVisibleInGroup+1). Expanding reveals ALL
// entries.
func IsReadGroupExpandable(reads []ToolCallInfo) bool {
	return len(reads) > maxVisibleInGroup+1
}

// isErrorExpandable reports whether a tool's error content would be
// truncated in the compact error display. Returns true when expanding
// would reveal more error detail — either because the error message
// exceeds maxErrorDisplayLen chars, or because the full result contains
// additional lines beyond the first-line error (result-prefixed errors).
func isErrorExpandable(tc ToolCallInfo) bool {
	errMsg := toolCallError(tc)
	if errMsg == "" {
		return false
	}
	if len(errMsg) > maxErrorDisplayLen {
		return true
	}
	// For result-prefixed errors, check if the full result has more
	// lines than the single-line compact error display shows.
	if strings.HasPrefix(tc.Result, resultErrorPrefix) {
		lines := strings.Split(strings.TrimRight(strings.TrimSpace(tc.Result), "\n"), "\n")
		return len(lines) > 1
	}
	return false
}

// isContentExpandable checks whether a tool's resolved display content
// exceeds the given line cap (used by Shell and similar tools). For
// failed/errored calls, delegates to isErrorExpandable — a long error
// message is worth expanding even when the tool's output content is
// absent.
func isContentExpandable(tc ToolCallInfo, info toolDisplayInfo, maxLines int) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return isErrorExpandable(tc)
	}
	if toolCallError(tc) != "" {
		return isErrorExpandable(tc)
	}
	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		return false
	}
	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")
	return len(lines) > maxLines+1
}

// isThinkExpandable checks whether a think tool's thought text exceeds
// maxThinkLines. The think tool extracts content from args (not Result),
// so it uses the same extraction as renderCompactThink. For errors,
// delegates to isErrorExpandable.
func isThinkExpandable(tc ToolCallInfo, info toolDisplayInfo) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return isErrorExpandable(tc)
	}
	content := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
	if content == "" || strings.TrimSpace(content) == "" {
		return false
	}
	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")
	return len(lines) > maxThinkLines+1
}

// isDiscoveryExpandable checks whether a discovery tool (List, Find,
// Search) has result entries. The compact renderer shows only a count
// summary ("Found 12 matches"); the expanded renderer shows all entries.
// Any non-empty result means expanding adds value. For errors,
// delegates to isErrorExpandable.
func isDiscoveryExpandable(tc ToolCallInfo, info toolDisplayInfo) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return isErrorExpandable(tc)
	}
	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		return false
	}
	return countResultEntries(content) > 0
}

// isUnknownExpandable checks whether an unknown/MCP tool's result
// exceeds maxUnknownOutputLines, or whether its error content would
// be truncated in the compact display.
func isUnknownExpandable(tc ToolCallInfo) bool {
	if toolCallError(tc) != "" {
		return isErrorExpandable(tc)
	}
	result := strings.TrimSpace(tc.Result)
	if result == "" {
		return false
	}
	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	return len(lines) > maxUnknownOutputLines+1
}

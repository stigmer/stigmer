package toolrender

import "strings"

// IsExpandable reports whether the expanded rendering of tc would show
// more content than the compact rendering. Used by the inline renderer
// to decide whether to display the "(ctrl+o to expand)" hint.
//
// Tools whose compact and expanded renderers produce identical output
// (Read, Write, Edit, Create, Delete) always return false. Tools that
// truncate content in compact mode (Shell, Thinking, Discovery,
// Unknown/MCP) return true only when the content exceeds the truncation
// threshold — i.e., when expanding would actually reveal more.
func IsExpandable(tc ToolCallInfo) bool {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return isUnknownExpandable(tc)
	}
	switch {
	case info.label == "Read":
		return false
	case isWriteOrEditLabel(info.label):
		return false
	case info.label == "Delete":
		return false
	case isShellLabel(info.label):
		return isContentExpandable(tc, info, maxShellOutputLines)
	case isDiscoveryLabel(info.label):
		return isDiscoveryExpandable(tc, info)
	case info.label == "Thinking":
		return isThinkExpandable(tc, info)
	default:
		return false
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

// isContentExpandable checks whether a tool's resolved display content
// exceeds the given line cap (used by Shell and similar tools). Returns
// false for failed/errored calls and empty content — those render
// identically in compact and expanded modes.
func isContentExpandable(tc ToolCallInfo, info toolDisplayInfo, maxLines int) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return false
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
// so it uses the same extraction as renderCompactThink.
func isThinkExpandable(tc ToolCallInfo, info toolDisplayInfo) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return false
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
// Any non-empty result means expanding adds value.
func isDiscoveryExpandable(tc ToolCallInfo, info toolDisplayInfo) bool {
	if tc.Status == "failed" || tc.Error != "" {
		return false
	}
	content := resolveDisplayContent(tc, info)
	if content == "" || strings.TrimSpace(content) == "" {
		return false
	}
	return countResultEntries(content) > 0
}

// isUnknownExpandable checks whether an unknown/MCP tool's result
// exceeds maxUnknownOutputLines. Unknown tools always have the same
// compact structure: header + optional input args + capped result lines.
func isUnknownExpandable(tc ToolCallInfo) bool {
	if toolCallError(tc) != "" {
		return false
	}
	result := strings.TrimSpace(tc.Result)
	if result == "" {
		return false
	}
	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	return len(lines) > maxUnknownOutputLines+1
}

package toolrender

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/x/ansi"
)

// extractPrimaryArg retrieves the value of the primary field from args.
// Returns an empty string if args is nil or the field is absent.
func extractPrimaryArg(args map[string]interface{}, field string) string {
	if args == nil || field == "" {
		return ""
	}

	val, ok := args[field]
	if !ok {
		return ""
	}

	return formatArgValue(val)
}

// extractPrimaryArgWithFallbacks tries the primary field first, then each
// fallback in order. Returns the first non-empty value found.
//
// This handles argument name variance across agent frameworks — for example,
// deepagents may send "file_path" while other tools send "path" for reads.
func extractPrimaryArgWithFallbacks(args map[string]interface{}, primary string, fallbacks []string) string {
	if val := extractPrimaryArg(args, primary); val != "" {
		return val
	}
	for _, fb := range fallbacks {
		if val := extractPrimaryArg(args, fb); val != "" {
			return val
		}
	}
	return ""
}

// extractFirstArg returns the value of the alphabetically first argument.
// Used as a fallback for unknown tools where no primary field is defined.
func extractFirstArg(args map[string]interface{}) string {
	if len(args) == 0 {
		return ""
	}

	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return formatArgValue(args[keys[0]])
}

// formatArgValue converts an argument value to a display string.
func formatArgValue(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		return fmt.Sprintf("%t", val)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", val)
	}
}

// styleValue applies appropriate styling based on whether the tool is dangerous.
func styleValue(val string, dangerous bool) string {
	if dangerous {
		return dangerStyle.Render(val)
	}
	return val
}

// formatSize returns a human-readable size string.
func formatSize(chars int) string {
	if chars < 1024 {
		return fmt.Sprintf("%d chars", chars)
	}

	kb := float64(chars) / 1024
	if kb < 10 {
		return fmt.Sprintf("%.1f KB", kb)
	}

	return fmt.Sprintf("%.0f KB", kb)
}

// formatDuration returns a compact duration string.
func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}

	return d.Truncate(100 * time.Millisecond).String()
}

// truncate shortens a string to maxLen, appending "..." if truncated.
// This operates on raw rune counts and must only be used on plain-text strings
// (no ANSI escape sequences). For strings that may contain ANSI codes, use
// truncateANSI instead.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

// truncateANSI shortens a string that may contain ANSI escape sequences to
// maxLen visible characters, appending "..." if truncated. ANSI escape codes
// are preserved and do not count toward the visible width.
//
// This is the ANSI-safe counterpart of truncate and must be used whenever the
// input may contain syntax-highlighted content with embedded escape codes.
func truncateANSI(s string, maxLen int) string {
	if ansi.StringWidth(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return ansi.Truncate(s, maxLen, "")
	}
	return ansi.Truncate(s, maxLen-3, "...")
}

// previewMaxWidth is the maximum character width for a result preview line.
// Keeps the preview compact enough to fit on a single terminal line.
const previewMaxWidth = 72

// ---------------------------------------------------------------------------
// Defense-in-depth: ToolMessage repr stripping
// ---------------------------------------------------------------------------

// stripToolMessageRepr detects and cleans raw Python repr strings that may
// leak through when the backend fails to extract the .content attribute.
//
// Two repr formats are handled:
//
// 1. ToolMessage repr:
//
//	content="Directory '/bin/skills' is empty" name='ls' tool_call_id='toolu_...'
//	content='bin/skills/a34ed...' name='glob' tool_call_id='toolu_...'
//
// 2. CommandUpdate repr (from LangGraph Command objects after approval resume):
//
//	CommandUpdate('files': [...], 'messages': [ToolMessage(content='Updated file foo.txt', ...)])
//
// If the input matches either pattern, the meaningful content is extracted.
// Otherwise the input is returned unchanged.
func stripToolMessageRepr(s string) string {
	// Pattern 1: ToolMessage repr — starts with "content="
	if strings.HasPrefix(s, "content=") {
		// Look for ToolMessage metadata fields that follow the content value.
		// The marker " name=" always appears after the content value in a repr.
		for _, marker := range []string{" name='", ` name="`} {
			if idx := strings.Index(s, marker); idx >= 0 {
				content := s[len("content="):idx]
				return unquote(content)
			}
		}
	}

	// Pattern 2: CommandUpdate repr — starts with "CommandUpdate("
	if strings.HasPrefix(s, "CommandUpdate(") {
		return extractCommandUpdateContent(s)
	}

	return s
}

// extractCommandUpdateContent extracts the ToolMessage content from a raw
// Python CommandUpdate repr string. This handles the case where a LangGraph
// Command object's repr leaks through to the CLI.
//
// It scans for ToolMessage(content='...' or ToolMessage(content="..." and
// extracts the quoted content value.
//
// Returns the original string if no ToolMessage content can be found — the
// caller's gutter formatting will still handle it gracefully.
func extractCommandUpdateContent(s string) string {
	// Try both single-quoted and double-quoted ToolMessage content.
	for _, prefix := range []string{"ToolMessage(content='", `ToolMessage(content="`} {
		idx := strings.Index(s, prefix)
		if idx < 0 {
			continue
		}
		contentStart := idx + len(prefix)
		// The closing quote character matches the opening one.
		closingQuote := prefix[len(prefix)-1]
		endIdx := strings.Index(s[contentStart:], string(closingQuote))
		if endIdx >= 0 {
			return s[contentStart : contentStart+endIdx]
		}
	}

	// No extractable ToolMessage content found.
	return s
}

// unquote removes matching surrounding single or double quotes from a string.
// Returns the input unchanged if it is not quoted or is too short.
func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '\'' && s[len(s)-1] == '\'') || (s[0] == '"' && s[len(s)-1] == '"') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// ---------------------------------------------------------------------------
// Preview formatters
// ---------------------------------------------------------------------------

// formatResultPreview formats a tool result as a compact, comma-separated
// summary for display below the tool header. It splits the result by newlines,
// joins the entries with ", ", and truncates to fit one line.
//
// As a defense-in-depth measure, raw ToolMessage repr strings are stripped
// before formatting — even though the backend should already handle this.
//
// Returns an empty string if the result is empty or contains no useful content
// (e.g., only whitespace).
//
// Examples:
//
//	"bin, etc, home, opt, tmp, usr, var, workspace"
//	"inputs/, outputs/"
//	"No files matching pattern '**/*.py'"
func formatResultPreview(result string) string {
	result = strings.TrimSpace(result)
	if result == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	lines := strings.Split(result, "\n")

	// Single-line results (including "no match" messages) pass through directly.
	if len(lines) == 1 {
		return truncate(result, previewMaxWidth)
	}

	// Multi-line results: join entries with ", " for a compact summary.
	entries := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			entries = append(entries, line)
		}
	}
	if len(entries) == 0 {
		return ""
	}

	joined := strings.Join(entries, ", ")
	return truncate(joined, previewMaxWidth)
}

// formatFirstLinePreview extracts the first non-empty line from a tool result
// and returns it as a truncated excerpt. Used for file read tools where a brief
// peek at the content confirms the agent read the correct file.
//
// As a defense-in-depth measure, raw ToolMessage repr strings are stripped
// before extracting the first line.
//
// Returns an empty string if the result is empty or contains no useful content.
//
// Examples:
//
//	"package main"
//	"syntax = \"proto3\";"
//	"apiVersion: v1"
func formatFirstLinePreview(result string) string {
	result = strings.TrimSpace(result)
	if result == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	firstLine := firstNonEmptyLine(result)
	if firstLine == "" {
		return ""
	}

	return truncate(firstLine, previewMaxWidth)
}

// firstNonEmptyLine returns the first line in s that contains non-whitespace
// characters. Returns an empty string if no such line exists.
func firstNonEmptyLine(s string) string {
	for _, line := range strings.SplitN(s, "\n", -1) {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

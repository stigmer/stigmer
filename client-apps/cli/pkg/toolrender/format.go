package toolrender

import (
	"fmt"
	"sort"
	"strings"
	"time"
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
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

// previewMaxWidth is the maximum character width for a result preview line.
// Keeps the preview compact enough to fit on a single terminal line.
const previewMaxWidth = 72

// formatResultPreview formats a tool result as a compact, comma-separated
// summary for display below the tool header. It splits the result by newlines,
// joins the entries with ", ", and truncates to fit one line.
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

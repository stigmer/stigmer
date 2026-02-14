package toolrender

import (
	"fmt"
	"sort"
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

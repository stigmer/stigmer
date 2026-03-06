package approval

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
)

// toolCategory defines how to format arguments for a specific type of tool.
type toolCategory struct {
	// primaryField is the most important argument field to display first.
	primaryField string
	// label is the human-readable name shown for the primary field.
	label string
	// dangerous marks tools that perform destructive operations.
	// Dangerous tool values are rendered with warning styling.
	dangerous bool
}

// toolCategories maps known tool names to their formatting category.
// Unknown tools fall back to generic key-value formatting.
//
// This map is intentionally extensible — add new tool names as the platform
// introduces new agent capabilities.
var toolCategories = map[string]toolCategory{
	// Shell/command execution
	"shell":           {primaryField: "command", label: "Command"},
	"bash":            {primaryField: "command", label: "Command"},
	"execute":         {primaryField: "command", label: "Command"},
	"execute_command": {primaryField: "command", label: "Command"},
	"run_command":     {primaryField: "command", label: "Command"},
	"terminal":        {primaryField: "command", label: "Command"},

	// File write operations
	"write_file":     {primaryField: "path", label: "Path"},
	"create_file":    {primaryField: "path", label: "Path"},
	"overwrite_file": {primaryField: "path", label: "Path"},
	"edit_file":      {primaryField: "path", label: "Path"},

	// File delete operations (dangerous)
	"delete_file": {primaryField: "path", label: "Path", dangerous: true},
	"remove_file": {primaryField: "path", label: "Path", dangerous: true},

	// Read operations
	"read_file":      {primaryField: "path", label: "Path"},
	"list_directory": {primaryField: "path", label: "Path"},
}

// Styles for formatted argument output.
var (
	primaryValueStyle = lipgloss.NewStyle().Bold(true)
	dangerValueStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Bold(true)
	secondaryStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
)

// FormatArgs formats tool arguments for approval display.
//
// For known tools, the most decision-relevant field is shown first with emphasis.
// For unknown tools, all fields are shown as key-value pairs in alphabetical order.
// If argsPreview is not valid JSON, it is returned with consistent indentation.
//
// This function never panics — invalid input always produces reasonable output.
func FormatArgs(toolName, argsPreview string) string {
	if argsPreview == "" {
		return ""
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsPreview), &args); err != nil {
		// Not valid JSON — indent and return as-is
		return indentLines(argsPreview)
	}

	if len(args) == 0 {
		return ""
	}

	cat, known := toolCategories[toolName]
	if !known {
		return formatAllFields(args)
	}

	return formatWithPrimaryField(args, cat)
}

// formatWithPrimaryField renders the primary field prominently, then shows
// remaining fields in alphabetical order with dimmed styling.
func formatWithPrimaryField(args map[string]interface{}, cat toolCategory) string {
	var lines []string

	// Primary field first, with emphasis
	if val, ok := args[cat.primaryField]; ok {
		valStr := formatValue(val)
		if cat.dangerous {
			valStr = dangerValueStyle.Render(valStr)
		} else {
			valStr = primaryValueStyle.Render(valStr)
		}
		lines = append(lines, fmt.Sprintf("%s: %s", cat.label, valStr))
	}

	// Remaining fields in alphabetical order, dimmed
	for _, key := range sortedKeys(args) {
		if key == cat.primaryField {
			continue
		}
		valStr := formatValue(args[key])
		lines = append(lines, secondaryStyle.Render(fmt.Sprintf("%s: %s", key, valStr)))
	}

	return strings.Join(lines, "\n")
}

// formatAllFields renders all fields as key-value pairs in alphabetical order.
// Used for unknown tools where no field takes priority.
func formatAllFields(args map[string]interface{}) string {
	var lines []string
	for _, key := range sortedKeys(args) {
		lines = append(lines, fmt.Sprintf("%s: %s", key, formatValue(args[key])))
	}
	return strings.Join(lines, "\n")
}

// formatValue converts a JSON-decoded value to a human-readable display string.
func formatValue(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		// JSON numbers are always float64. Display integers without decimals.
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		return fmt.Sprintf("%t", val)
	case nil:
		return "null"
	default:
		// Complex types (arrays, nested objects) — marshal back to JSON
		b, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			return fmt.Sprintf("%v", val)
		}
		return string(b)
	}
}

// sortedKeys returns the keys of a map in alphabetical order.
func sortedKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// indentLines adds a two-space indent to each non-empty line.
func indentLines(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = "  " + line
		}
	}
	return strings.Join(lines, "\n")
}

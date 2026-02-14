// Package toolrender formats tool call information for structured CLI display.
//
// It categorizes tools by type (shell, file read, file write, etc.) and renders
// them with appropriate icons and emphasis. This package accepts primitive types
// to stay decoupled from proto definitions.
//
// Usage:
//
//	line := toolrender.Render(toolrender.ToolCallInfo{
//	    Name: "read_file",
//	    Args: map[string]interface{}{"path": "main.go"},
//	})
//	fmt.Println(line) // "  📖 Read: main.go"
package toolrender

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// ToolCallInfo holds the primitive fields needed to render a tool call.
// Callers convert from proto or other sources into this struct.
type ToolCallInfo struct {
	// Name of the tool (e.g. "shell", "read_file").
	Name string

	// Args are the tool arguments as key-value pairs.
	Args map[string]interface{}

	// Status of the tool call: "pending", "running", "completed", "failed".
	Status string

	// Result is the tool's output text (may be empty for in-progress calls).
	Result string

	// Error is populated when Status is "failed".
	Error string

	// Duration of the tool call execution. Zero if unavailable.
	Duration time.Duration
}

// toolDisplayInfo defines how to render a specific category of tool.
type toolDisplayInfo struct {
	// icon is the emoji prefix for this tool category.
	icon string
	// label is the human-readable action name (e.g. "Read", "Shell").
	label string
	// primaryField is the most important argument to extract and show.
	primaryField string
	// dangerous marks destructive tools for warning styling.
	dangerous bool
	// showPreview enables a second dimmed line showing a truncated result.
	// Used for discovery tools (ls, glob, grep) where the result IS the value.
	showPreview bool
}

// toolDisplayMap maps known tool names to their display configuration.
//
// This map is intentionally extensible — add new tool names as the platform
// introduces new agent capabilities.
var toolDisplayMap = map[string]toolDisplayInfo{
	// Shell/command execution
	"shell":           {icon: "🖥 ", label: "Shell", primaryField: "command"},
	"bash":            {icon: "🖥 ", label: "Shell", primaryField: "command"},
	"execute":         {icon: "🖥 ", label: "Execute", primaryField: "command"},
	"execute_command": {icon: "🖥 ", label: "Shell", primaryField: "command"},
	"run_command":     {icon: "🖥 ", label: "Shell", primaryField: "command"},
	"terminal":        {icon: "🖥 ", label: "Shell", primaryField: "command"},

	// File read operations
	"read":           {icon: "📖", label: "Read", primaryField: "path"},
	"read_file":      {icon: "📖", label: "Read", primaryField: "path"},
	"list_directory": {icon: "📂", label: "List", primaryField: "path", showPreview: true},

	// Directory listing (platform tool name)
	"ls": {icon: "📂", label: "List", primaryField: "path", showPreview: true},

	// File search / pattern matching (platform tool names)
	"glob": {icon: "🔍", label: "Find", primaryField: "pattern", showPreview: true},
	"grep": {icon: "🔎", label: "Search", primaryField: "pattern", showPreview: true},

	// File write operations
	"write":          {icon: "📝", label: "Write", primaryField: "path"},
	"write_file":     {icon: "📝", label: "Write", primaryField: "path"},
	"create_file":    {icon: "📝", label: "Create", primaryField: "path"},
	"overwrite_file": {icon: "📝", label: "Write", primaryField: "path"},

	// File edit operations
	"edit":      {icon: "✏️ ", label: "Edit", primaryField: "path"},
	"edit_file": {icon: "✏️ ", label: "Edit", primaryField: "path"},

	// File delete operations (dangerous)
	"delete_file": {icon: "⚠️ ", label: "Delete", primaryField: "path", dangerous: true},
	"remove_file": {icon: "⚠️ ", label: "Delete", primaryField: "path", dangerous: true},
}

// Styles for tool call rendering.
var (
	labelStyle  = lipgloss.NewStyle().Bold(true)
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	dangerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Bold(true)
)

// Render returns a structured single-line display of a tool call.
//
// Known tools are rendered with a category-specific icon and the most relevant
// argument highlighted. Unknown tools fall back to a generic format showing the
// tool name and first argument value.
//
// Examples:
//
//	"  📖 Read: main.go"
//	"  🖥  Shell: ls -la /tmp"
//	"  📝 Write: outputs/SKILL.md"
//	"  ⚠️  Delete: /tmp/old.txt"
//	"  🔧 custom_tool: some_value"
//
// This function never panics — nil or empty input produces reasonable output.
func Render(tc ToolCallInfo) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderUnknown(tc)
	}

	return renderKnown(tc, info)
}

// RenderResult returns a compact display of a tool result message.
//
// Used for MESSAGE_TOOL messages where we have the result content but not
// the originating tool name. Shows a truncated preview with size info.
//
// Examples:
//
//	"  ↳ 1164 chars"
//	"  ↳ (empty)"
func RenderResult(content string) string {
	if content == "" {
		return dimStyle.Render("  ↳ (empty)")
	}

	size := formatSize(len(content))
	return dimStyle.Render(fmt.Sprintf("  ↳ %s", size))
}

// RenderResultWithPreview returns a display of a tool result message with content preview.
//
// The backend formats MESSAGE_TOOL content nicely (e.g., "read(path='file.txt') -> 1164 chars"),
// so we display a truncated version of this instead of just the byte count.
//
// Examples:
//
//	"  ↳ read(path='inputs/agent-api.proto') -> 1164 chars"
//	"  ↳ execute(command='ls -la') -> 245 chars"
//	"  ↳ (empty)"
func RenderResultWithPreview(content string) string {
	if content == "" {
		return dimStyle.Render("  ↳ (empty)")
	}

	// The content is already nicely formatted by the backend.
	// Show a truncated preview (max ~80 chars to fit on one line).
	preview := truncate(content, 80)
	return dimStyle.Render("  ↳ " + preview)
}

// renderKnown formats a tool call with category-specific icon, label, and primary arg.
//
// For discovery tools (showPreview=true) with a non-empty Result, a second
// indented line is appended showing a truncated result preview. This gives the
// user visibility into what the tool found without requiring separate result
// messages.
//
// Example with preview:
//
//	"  📂 List: /workspace (97 chars, 3ms)\n     inputs/, outputs/"
func renderKnown(tc ToolCallInfo, info toolDisplayInfo) string {
	primaryVal := extractPrimaryArg(tc.Args, info.primaryField)

	var line string
	if primaryVal != "" {
		styled := styleValue(primaryVal, info.dangerous)
		line = fmt.Sprintf("  %s %s: %s", info.icon, labelStyle.Render(info.label), styled)
	} else {
		line = fmt.Sprintf("  %s %s", info.icon, labelStyle.Render(info.label))
	}

	suffix := renderSuffix(tc)
	if suffix != "" {
		line += " " + dimStyle.Render(suffix)
	}

	// Append result preview for discovery tools (ls, glob, grep).
	if info.showPreview && tc.Result != "" {
		preview := formatResultPreview(tc.Result)
		if preview != "" {
			line += "\n" + dimStyle.Render("     "+preview)
		}
	}

	return line
}

// renderUnknown formats an unrecognized tool with a generic icon and name.
func renderUnknown(tc ToolCallInfo) string {
	firstVal := extractFirstArg(tc.Args)

	var line string
	if firstVal != "" {
		line = fmt.Sprintf("  🔧 %s: %s", labelStyle.Render(tc.Name), firstVal)
	} else {
		line = fmt.Sprintf("  🔧 %s", labelStyle.Render(tc.Name))
	}

	suffix := renderSuffix(tc)
	if suffix != "" {
		line += " " + dimStyle.Render(suffix)
	}

	return line
}

// renderSuffix builds an optional suffix with result size, duration, or error.
func renderSuffix(tc ToolCallInfo) string {
	if tc.Error != "" {
		return fmt.Sprintf("(error: %s)", truncate(tc.Error, 40))
	}

	var parts []string

	if tc.Result != "" {
		parts = append(parts, formatSize(len(tc.Result)))
	}

	if tc.Duration > 0 {
		parts = append(parts, formatDuration(tc.Duration))
	}

	if len(parts) == 0 {
		return ""
	}

	return "(" + strings.Join(parts, ", ") + ")"
}

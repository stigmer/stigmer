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

// previewStyle controls how (or whether) a result preview line is rendered
// beneath the main tool call line.
type previewStyle int

const (
	// previewNone disables result previews. Used for tools where the result is
	// either too large or not informative in summary form (shell, write, edit, delete).
	previewNone previewStyle = iota

	// previewDiscovery joins multi-line results with ", " into a compact summary.
	// Ideal for discovery tools (ls, glob, grep) where the result IS the value.
	previewDiscovery

	// previewFirstLine shows the first non-empty line of the result as a brief
	// content excerpt. Useful for file read tools where a peek at the content
	// confirms the agent read the right file.
	previewFirstLine

	// previewFileContent shows a multi-line gutter-bordered preview of file
	// content with a "N more lines" indicator. Provides richer context than
	// previewFirstLine — shows up to filePreviewMaxLines lines so users can
	// distinguish between files with identical first lines (e.g., proto files
	// that all start with `syntax = "proto3";`).
	previewFileContent
)

// toolDisplayInfo defines how to render a specific category of tool.
type toolDisplayInfo struct {
	// icon is the emoji prefix for this tool category.
	icon string
	// label is the human-readable action name (e.g. "Read", "Shell").
	label string
	// primaryField is the most important argument to extract and show.
	primaryField string
	// fallbackFields are alternative argument names tried in order when
	// primaryField is not found in the tool args. This handles variance in
	// argument naming across different agent frameworks and sandbox tools.
	fallbackFields []string
	// dangerous marks destructive tools for warning styling.
	dangerous bool
	// preview controls the result preview style. See previewStyle constants.
	preview previewStyle
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

	// File read operations — fallbackFields handle arg name variance across
	// agent frameworks (deepagents uses "file_path", others may use "file").
	"read":      {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFileContent},
	"read_file": {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFileContent},

	// Directory listing
	"list_directory": {icon: "📂", label: "List", primaryField: "path", preview: previewDiscovery},
	"ls":             {icon: "📂", label: "List", primaryField: "path", preview: previewDiscovery},

	// File search / pattern matching
	"glob": {icon: "🔍", label: "Find", primaryField: "pattern", preview: previewDiscovery},
	"grep": {icon: "🔎", label: "Search", primaryField: "pattern", preview: previewDiscovery},

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

// RenderExpanded returns the tool call header followed by the complete result
// content with gutter borders. Used by the TUI's expanded state to show all
// output lines instead of a truncated preview.
//
// When the result is empty, the output is identical to the header produced by
// Render (without the preview). For unknown tools, the generic header is used.
//
// Examples:
//
//	"  📖 Read: main.go (1.5 KB, 33 lines)\n     │ package main\n     │ \n     │ import \"fmt\"\n     │ ..."
//	"  📂 List: /workspace (97 chars)\n     │ bin\n     │ etc\n     │ home"
func RenderExpanded(tc ToolCallInfo) string {
	info, known := toolDisplayMap[tc.Name]

	var header string
	if known {
		header = renderKnownHeader(tc, info)
	} else {
		header = renderUnknown(tc)
	}

	if tc.Result == "" {
		return header
	}

	// Extract filename for syntax highlighting. For file-read tools, the
	// filename comes from the args. For other tools, this returns "" and
	// highlighting is gracefully skipped.
	filename := extractFilename(tc.Args)

	fullContent := formatFullResultWithGutter(tc.Result, filename)
	if fullContent == "" {
		return header
	}

	// formatFullResultWithGutter handles styling internally (dim gutter +
	// syntax-highlighted content), so we append directly.
	return header + "\n" + fullContent
}


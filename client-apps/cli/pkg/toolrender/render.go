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

	"charm.land/lipgloss/v2"
)

// ToolCallInfo holds the primitive fields needed to render a tool call.
// Callers convert from proto or other sources into this struct.
type ToolCallInfo struct {
	// ID is the unique identifier for this tool call. Used by the TUI to
	// track ownership — the state tracker uses this to determine whether a
	// tool call's visual block is already managed. Empty for tool calls
	// created without an ID (e.g., from MESSAGE_TOOL content fallback).
	ID string

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

	// IsStreaming indicates the tool is actively producing output.
	// When true, Result contains partial output accumulated so far.
	// Mirrors the proto ToolCall.is_streaming field.
	IsStreaming bool

	// StreamingSource identifies what is currently being streamed.
	// "input" = LLM generating args, "output" = tool producing results.
	// Empty when not streaming. Derived from proto
	// ToolCall.streaming_source; consumers use this instead of
	// client-side heuristics to choose the correct rendering mode.
	StreamingSource string

	// ServerName is the MCP server slug that provides this tool.
	// Empty for built-in sandbox tools. When populated, the compact
	// renderer shows "server/tool" in the header for disambiguation.
	// Populated from proto ToolCall.mcp_server_slug (Phase 2).
	ServerName string

	// Kind is the harness-agnostic tool classification from proto
	// ToolCall.tool_kind. When set, it drives display for tools whose names
	// are not in toolDisplayMap (notably Cursor's PascalCase names), so the
	// CLI renders them with the right label and primary argument instead of
	// the generic unknown fallback. Empty for legacy executions, where the
	// renderer falls back to name-based classification.
	Kind ToolKind
}

// previewStyle controls how (or whether) a result preview line is rendered
// beneath the main tool call line.
type previewStyle int

const (
	// previewNone disables result previews. Used for tools where no content
	// body exists (e.g., delete tools that only have a file path).
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

// contentSource controls which content is used for preview and expanded views.
// Different tools have different display needs: read tools show output (the file
// content read), while write tools show input (the content being written). This
// enum makes that intent explicit per tool rather than relying on implicit
// fallback ordering.
type contentSource int

const (
	// contentSourceResult (default zero value): display tc.Result. Falls back
	// to args content (via contentArgField) if result is empty. Used by read,
	// shell, discovery, and unknown tools where the output IS the value.
	contentSourceResult contentSource = iota

	// contentSourceInput: always prefer args content from contentArgField,
	// even when tc.Result is populated. Falls back to tc.Result only if args
	// content is empty. Used by write and edit tools where the input (the
	// file content being written) is always more interesting than the result
	// (a confirmation message like "Successfully wrote N characters").
	contentSourceInput
)

// toolDisplayInfo defines how to render a specific category of tool.
type toolDisplayInfo struct {
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
	// contentSource controls whether the displayable content comes from the
	// tool's result (output) or arguments (input). See contentSource constants.
	// Zero value (contentSourceResult) means show output — the common case.
	contentSource contentSource
	// contentArgField is the arg field that contains displayable content for
	// tools where the interesting content lives in the arguments rather than
	// the result. For write tools this is "contents" (the file content being
	// written). Used by resolveDisplayContent when contentSource is
	// contentSourceInput, or as a fallback when tc.Result is empty.
	contentArgField string
	// contentArgFallbacks are alternative arg names for contentArgField,
	// tried in order when contentArgField is not found.
	contentArgFallbacks []string
}

// toolDisplayMap maps known tool names to their display configuration.
//
// This map is intentionally extensible — add new tool names as the platform
// introduces new agent capabilities.
var toolDisplayMap = map[string]toolDisplayInfo{
	"shell":           {label: "Shell", primaryField: "command", preview: previewFileContent},
	"bash":            {label: "Shell", primaryField: "command", preview: previewFileContent},
	"execute":         {label: "Execute", primaryField: "command", preview: previewFileContent},
	"execute_command": {label: "Shell", primaryField: "command", preview: previewFileContent},
	"run_command":     {label: "Shell", primaryField: "command", preview: previewFileContent},
	"terminal":        {label: "Shell", primaryField: "command", preview: previewFileContent},

	"read":      {label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFileContent},
	"read_file": {label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFileContent},

	"list_directory": {label: "List", primaryField: "path", preview: previewDiscovery},
	"ls":             {label: "List", primaryField: "path", preview: previewDiscovery},

	"glob": {label: "Find", primaryField: "pattern", preview: previewDiscovery},
	"grep": {label: "Search", primaryField: "pattern", preview: previewDiscovery},

	"write":          {label: "Write", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"}},
	"write_file":     {label: "Write", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"}},
	"create_file":    {label: "Create", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"}},
	"overwrite_file": {label: "Write", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"}},

	"edit":      {label: "Edit", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "new_text", contentArgFallbacks: []string{"new_string", "replacement", "content"}},
	"edit_file": {label: "Edit", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "new_text", contentArgFallbacks: []string{"new_string", "replacement", "content"}},

	"delete_file": {label: "Delete", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, dangerous: true},
	"remove_file": {label: "Delete", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, dangerous: true},

	"think": {label: "Thinking", preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "thought"},

	"task": {label: "Sub-agent", primaryField: "description", fallbackFields: []string{"prompt"}},
}

// kindDisplayMap provides presentation metadata per ToolKind. It is the
// fallback used by resolveDisplayInfo when a tool name is not in toolDisplayMap
// — chiefly the Cursor harness's PascalCase names (StrReplace, Shell, Grep...),
// which resolve to a kind via the shared classifier. Classification lives in
// toolkind.go (the single source of truth); this map is presentation only.
var kindDisplayMap = map[ToolKind]toolDisplayInfo{
	ToolKindFileRead:   {label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFileContent},
	ToolKindFileWrite:  {label: "Write", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"}},
	ToolKindFileEdit:   {label: "Edit", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "new_string", contentArgFallbacks: []string{"new_text", "replacement", "content"}},
	ToolKindFileDelete: {label: "Delete", primaryField: "path", fallbackFields: []string{"file_path", "file", "filename"}, dangerous: true},
	ToolKindShell:      {label: "Shell", primaryField: "command", preview: previewFileContent},
	ToolKindSearch:     {label: "Search", primaryField: "pattern", fallbackFields: []string{"query", "q"}, preview: previewDiscovery},
	ToolKindList:       {label: "List", primaryField: "path", preview: previewDiscovery},
	ToolKindFetch:      {label: "Fetch", primaryField: "url", fallbackFields: []string{"uri"}},
	ToolKindWebSearch:  {label: "Web Search", primaryField: "query", fallbackFields: []string{"q", "search_term"}},
	ToolKindThink:      {label: "Thinking", preview: previewFileContent, contentSource: contentSourceInput, contentArgField: "thought"},
	ToolKindSubagent:   {label: "Sub-agent", primaryField: "description", fallbackFields: []string{"prompt"}},
}

// resolveDisplayInfo returns the presentation metadata for a tool call, trying
// the name map first (preserves existing native labels) and falling back to the
// harness-agnostic kind. The bool is false only for genuinely unknown tools.
func resolveDisplayInfo(tc ToolCallInfo) (toolDisplayInfo, bool) {
	if info, ok := toolDisplayMap[tc.Name]; ok {
		return info, true
	}
	kind := ResolveToolKind(tc.Kind, tc.Name, tc.ServerName)
	if info, ok := kindDisplayMap[kind]; ok {
		return info, true
	}
	return toolDisplayInfo{}, false
}

// Styles for tool call rendering.
var (
	labelStyle  = lipgloss.NewStyle().Bold(true)
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	dangerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Bold(true)
)

// IsShellTool reports whether toolName represents a shell/command execution
// tool. Derived from toolDisplayMap entries whose primaryField is "command".
func IsShellTool(toolName string) bool {
	if info, ok := toolDisplayMap[toolName]; ok {
		return info.primaryField == "command"
	}
	// Cover harness names not in the legacy map (e.g. Cursor's "Shell").
	return ClassifyToolByName(toolName, "") == ToolKindShell
}

// HasPrimaryArg reports whether the tool call's args contain the primary
// display argument (or any of its fallback names) for the tool's type.
// Returns false when the tool is unknown or the args are nil/empty.
func HasPrimaryArg(tc ToolCallInfo) bool {
	info, ok := resolveDisplayInfo(tc)
	if !ok {
		return extractFirstArg(tc.Args) != ""
	}
	return extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields) != ""
}

// Render returns a structured single-line display of a tool call.
//
// Known tools are rendered with a label and the most relevant argument
// highlighted. Unknown tools fall back to a generic format showing the
// tool name and first argument value.
//
// Examples:
//
//	"  Read: main.go"
//	"  Shell: ls -la /tmp"
//	"  Write: outputs/SKILL.md"
//	"  Delete: /tmp/old.txt"
//	"  * custom_tool: some_value"
//
// This function never panics — nil or empty input produces reasonable output.
func Render(tc ToolCallInfo) string {
	info, known := resolveDisplayInfo(tc)
	if !known {
		return renderUnknown(tc)
	}

	return renderKnown(tc, info)
}

// StateBadge returns the badge string for a given tool lifecycle state.
// The badge is a small visual indicator appended to the tool header line.
//
// States and badges:
//   - "running":          ...
//   - "waiting_approval": ||
//   - "completed":        ✓
//   - "failed":           ✗
//   - "skipped":          ~
//   - anything else:      empty string (no badge)
func StateBadge(state string) string {
	switch state {
	case "running":
		return "..."
	case "waiting_approval":
		return "||"
	case "completed":
		return "✓"
	case "failed":
		return "✗"
	case "skipped":
		return "~"
	default:
		return ""
	}
}

// RenderWithBadge returns the tool call header with metadata and a status
// badge, followed by content preview lines. This is the collapsed (preview)
// rendering for a stateful tool block.
//
// For tools with displayable content, the header includes metadata (size,
// lines, duration) and up to 3 lines of content preview with a gutter border.
// The badge is the only element that changes across lifecycle transitions —
// everything else is stable.
//
// Examples:
//
//	"  Write: SKILL.md (11.0 KB, 384 lines) ...\n     │ # Agent Drafter\n     │ ...\n     ⋮ 381 more lines"
//	"  Read: main.go (1.5 KB, 33 lines) ✓\n     │ package main\n     │ ...\n     ⋮ 30 more lines"
//	"  Shell: ls -la /tmp ||"
//	"  * custom_tool: some_value ..."
func RenderWithBadge(tc ToolCallInfo, badge string) string {
	info, known := resolveDisplayInfo(tc)

	var header string
	if known {
		header = renderKnownHeader(tc, info)
	} else {
		header = renderUnknownHeader(tc)
	}

	if badge != "" {
		header += " " + dimStyle.Render(badge)
	}

	// Append content preview lines — the same 3-line preview that Render()
	// produces, placed after the badge on subsequent lines.
	var preview string
	if known {
		preview = renderPreviewLines(tc, info)
	} else {
		preview = renderUnknownPreview(tc)
	}
	if preview != "" {
		header += "\n" + preview
	}

	return header
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

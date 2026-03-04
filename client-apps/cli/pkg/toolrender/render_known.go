package toolrender

import (
	"fmt"
	"strings"
)

// resolveDisplayContent returns the best available content for rendering a
// tool call's preview and expanded view.
//
// The resolution strategy depends on info.contentSource:
//
//   - contentSourceResult (default): prefer tc.Result, fall back to args
//     content if result is empty. This is the common case for read, shell,
//     and discovery tools where the output IS the interesting content.
//
//   - contentSourceInput: always prefer args content from contentArgField,
//     even when tc.Result is populated. Falls back to tc.Result only if args
//     content is empty. This is used by write and edit tools where the input
//     (file content being written) is always more useful than the result
//     (a confirmation message like "Successfully wrote N characters").
func resolveDisplayContent(tc ToolCallInfo, info toolDisplayInfo) string {
	// For input-source tools (write/edit), always prefer args content.
	// This ensures that a completed write tool shows the file content
	// being written, not the "Successfully wrote N chars" confirmation.
	if info.contentSource == contentSourceInput && info.contentArgField != "" {
		content := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
		if content != "" {
			return content
		}
	}

	if tc.Result != "" {
		if info.primaryField == "command" {
			return CleanShellResult(tc.Result)
		}
		return tc.Result
	}

	// Fallback: try args content even for result-source tools (pre-completion
	// state where tc.Result is empty but content may exist in args).
	if info.contentArgField != "" {
		return extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
	}
	return ""
}

// renderKnownHeader produces the single-line header for a known tool call:
// icon, label, primary argument, and metadata suffix. No result preview is
// appended — this is the reusable building block for both Render (collapsed)
// and RenderExpanded (full content).
//
// Examples:
//
//	"  Read: main.go (1.5 KB, 33 lines, 4ms)"
//	"  List: /workspace (97 chars, 3ms)"
//	"  Shell: ls -la /tmp"
func renderKnownHeader(tc ToolCallInfo, info toolDisplayInfo) string {
	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var line string
	if primaryVal != "" {
		styled := styleValue(primaryVal, info.dangerous)
		line = fmt.Sprintf("  %s: %s", labelStyle.Render(info.label), styled)
	} else {
		line = fmt.Sprintf("  %s", labelStyle.Render(info.label))
	}

	// Build suffix — file content tools include line count alongside size.
	// Use resolveDisplayContent so write tools show line count from args.
	content := resolveDisplayContent(tc, info)
	var suffix string
	if info.preview == previewFileContent && content != "" {
		suffix = buildSuffixWithContent(tc, content, countLines(content))
	} else {
		suffix = renderSuffix(tc)
	}
	if suffix != "" {
		line += " " + dimStyle.Render(suffix)
	}

	return line
}

// renderPreviewLines generates the content preview lines for a known tool call.
// Returns the styled preview string (ready to append after a header line), or
// empty string if no preview is available or the tool's preview style is
// previewNone.
//
// This is the shared building block used by both Render (collapsed without badge)
// and RenderWithBadge (collapsed with badge) to ensure consistent preview
// rendering across all code paths.
func renderPreviewLines(tc ToolCallInfo, info toolDisplayInfo) string {
	if info.preview == previewNone {
		return ""
	}

	content := resolveDisplayContent(tc, info)
	if content == "" {
		return ""
	}

	var preview string
	switch info.preview {
	case previewDiscovery:
		preview = formatResultPreview(content)
	case previewFirstLine:
		preview = formatFirstLinePreview(content)
	case previewFileContent:
		preview = formatFileContentPreview(content, extractFilename(tc.Args))
	}

	if preview == "" {
		return ""
	}

	switch info.preview {
	case previewFileContent:
		// File content preview handles its own styling internally
		// (dim gutter + syntax-highlighted content), so we return
		// it directly without an outer dimStyle wrapper.
		return preview
	default:
		return dimStyle.Render("     " + preview)
	}
}

// renderKnown formats a tool call with category-specific icon, label, and primary arg.
//
// When the tool has a preview style configured and displayable content is available,
// additional lines are appended showing a content preview. The style determines the
// formatting:
//   - previewDiscovery: compact comma-separated summary (ls, glob, grep)
//   - previewFirstLine: first-line content excerpt
//   - previewFileContent: multi-line gutter-bordered preview with "N more lines"
//
// For write tools, displayable content comes from args (the file content being
// written), not from tc.Result. See resolveDisplayContent and contentSource.
//
// Examples:
//
//	"  List: /workspace (97 chars, 3ms)\n     inputs/, outputs/"
//	"  Read: main.go (1.5 KB, 33 lines, 4ms)\n     │ package main\n     │ ...\n     ⋮ 30 more lines"
//	"  Write: SKILL.md (3.2 KB, 45 lines)\n     │ # Agent Drafter\n     │ ...\n     ⋮ 42 more lines"
func renderKnown(tc ToolCallInfo, info toolDisplayInfo) string {
	line := renderKnownHeader(tc, info)

	if preview := renderPreviewLines(tc, info); preview != "" {
		line += "\n" + preview
	}

	return line
}

// renderUnknownHeader produces the single-line header for an unrecognized tool.
// Separated from renderUnknown so that RenderWithBadge can append a badge
// between the header and the preview lines.
func renderUnknownHeader(tc ToolCallInfo) string {
	firstVal := extractFirstArg(tc.Args)

	var line string
	if firstVal != "" {
		line = fmt.Sprintf("  * %s: %s", labelStyle.Render(tc.Name), firstVal)
	} else {
		line = fmt.Sprintf("  * %s", labelStyle.Render(tc.Name))
	}

	suffix := renderSuffix(tc)
	if suffix != "" {
		line += " " + dimStyle.Render(suffix)
	}

	return line
}

// renderUnknownPreview generates a content preview for an unrecognized tool
// (MCP tools, custom tools, etc.). Shows up to 3 lines of tc.Result with a
// gutter border, matching the visual language of known file content tools.
// Returns empty string if no result content is available.
func renderUnknownPreview(tc ToolCallInfo) string {
	if tc.Result == "" {
		return ""
	}
	return formatFileContentPreview(tc.Result, "")
}

// renderUnknown formats an unrecognized tool with a generic icon, name, and
// an optional content preview of the result.
func renderUnknown(tc ToolCallInfo) string {
	line := renderUnknownHeader(tc)

	if preview := renderUnknownPreview(tc); preview != "" {
		line += "\n" + preview
	}

	return line
}

// renderSuffix builds an optional suffix with result size, duration, or error.
// For tools that don't need line count metadata, this is the standard entry point.
func renderSuffix(tc ToolCallInfo) string {
	return buildSuffix(tc, 0)
}

// buildSuffix constructs a parenthesized suffix from the tool call metadata.
// When lineCount > 0, a human-readable line count is inserted between the size
// and duration parts (e.g., "(1.0 KB, 33 lines, 1ms)").
func buildSuffix(tc ToolCallInfo, lineCount int) string {
	if tc.Error != "" {
		return fmt.Sprintf("(error: %s)", truncate(tc.Error, 40))
	}

	var parts []string

	if tc.Result != "" {
		parts = append(parts, formatSize(len(tc.Result)))
	}

	if lineCount > 0 {
		parts = append(parts, formatLineCount(lineCount))
	}

	if tc.Duration > 0 {
		parts = append(parts, formatDuration(tc.Duration))
	}

	if len(parts) == 0 {
		return ""
	}

	return "(" + strings.Join(parts, ", ") + ")"
}

// buildSuffixWithContent constructs a parenthesized suffix using explicit
// content for size calculation rather than tc.Result. This is needed for tools
// like write where the displayable content comes from args, not tc.Result.
func buildSuffixWithContent(tc ToolCallInfo, content string, lineCount int) string {
	if tc.Error != "" {
		return fmt.Sprintf("(error: %s)", truncate(tc.Error, 40))
	}

	var parts []string

	if content != "" {
		parts = append(parts, formatSize(len(content)))
	}

	if lineCount > 0 {
		parts = append(parts, formatLineCount(lineCount))
	}

	if tc.Duration > 0 {
		parts = append(parts, formatDuration(tc.Duration))
	}

	if len(parts) == 0 {
		return ""
	}

	return "(" + strings.Join(parts, ", ") + ")"
}

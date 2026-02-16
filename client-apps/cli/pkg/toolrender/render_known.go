package toolrender

import (
	"fmt"
	"strings"
)

// resolveDisplayContent returns the best available content for rendering a
// tool call's preview and expanded view.
//
// For most tools the content is tc.Result (the tool's output). For tools
// like write/create where the interesting content lives in the arguments
// (e.g., the file content being written), it falls back to the arg field
// specified by info.contentArgField / info.contentArgFallbacks when
// tc.Result is empty.
func resolveDisplayContent(tc ToolCallInfo, info toolDisplayInfo) string {
	if tc.Result != "" {
		return tc.Result
	}
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
//	"  📖 Read: main.go (1.5 KB, 33 lines, 4ms)"
//	"  📂 List: /workspace (97 chars, 3ms)"
//	"  🖥  Shell: ls -la /tmp"
func renderKnownHeader(tc ToolCallInfo, info toolDisplayInfo) string {
	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	var line string
	if primaryVal != "" {
		styled := styleValue(primaryVal, info.dangerous)
		line = fmt.Sprintf("  %s %s: %s", info.icon, labelStyle.Render(info.label), styled)
	} else {
		line = fmt.Sprintf("  %s %s", info.icon, labelStyle.Render(info.label))
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
// written) when tc.Result is empty. See resolveDisplayContent.
//
// Examples:
//
//	"  📂 List: /workspace (97 chars, 3ms)\n     inputs/, outputs/"
//	"  📖 Read: main.go (1.5 KB, 33 lines, 4ms)\n     │ package main\n     │ ...\n     ⋮ 30 more lines"
//	"  📝 Write: SKILL.md (3.2 KB, 45 lines)\n     │ # Agent Drafter\n     │ ...\n     ⋮ 42 more lines"
func renderKnown(tc ToolCallInfo, info toolDisplayInfo) string {
	line := renderKnownHeader(tc, info)

	// Resolve the displayable content — tc.Result for most tools,
	// falling back to args content for write tools.
	content := resolveDisplayContent(tc, info)

	// Append content preview based on the configured preview style.
	if content != "" {
		var preview string
		switch info.preview {
		case previewDiscovery:
			preview = formatResultPreview(content)
		case previewFirstLine:
			preview = formatFirstLinePreview(content)
		case previewFileContent:
			preview = formatFileContentPreview(content, extractFilename(tc.Args))
		}
		if preview != "" {
			switch info.preview {
			case previewFileContent:
				// File content preview handles its own styling internally
				// (dim gutter + syntax-highlighted content), so we append
				// it directly without an outer dimStyle wrapper.
				line += "\n" + preview
			default:
				line += "\n" + dimStyle.Render("     "+preview)
			}
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

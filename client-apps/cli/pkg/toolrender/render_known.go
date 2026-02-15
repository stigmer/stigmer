package toolrender

import (
	"fmt"
	"strings"
)

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
	var suffix string
	if info.preview == previewFileContent && tc.Result != "" {
		suffix = buildSuffix(tc, countLines(tc.Result))
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
// When the tool has a preview style configured and a non-empty Result, additional
// lines are appended showing a result preview. The style determines the formatting:
//   - previewDiscovery: compact comma-separated summary (ls, glob, grep)
//   - previewFirstLine: first-line content excerpt
//   - previewFileContent: multi-line gutter-bordered preview with "N more lines"
//
// Examples:
//
//	"  📂 List: /workspace (97 chars, 3ms)\n     inputs/, outputs/"
//	"  📖 Read: main.go (1.5 KB, 33 lines, 4ms)\n     │ package main\n     │ ...\n     ⋮ 30 more lines"
func renderKnown(tc ToolCallInfo, info toolDisplayInfo) string {
	line := renderKnownHeader(tc, info)

	// Append result preview based on the configured preview style.
	if tc.Result != "" {
		var preview string
		switch info.preview {
		case previewDiscovery:
			preview = formatResultPreview(tc.Result)
		case previewFirstLine:
			preview = formatFirstLinePreview(tc.Result)
		case previewFileContent:
			preview = formatFileContentPreview(tc.Result, extractFilename(tc.Args))
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

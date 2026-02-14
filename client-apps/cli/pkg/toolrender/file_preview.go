package toolrender

import (
	"fmt"
	"strings"
)

// filePreviewMaxLines is the maximum number of lines shown in a file content
// preview. Three lines is enough to show meaningful differentiating content
// (e.g., package declarations in proto files) without overwhelming the terminal
// during rapid tool call sequences.
const filePreviewMaxLines = 3

// gutterPrefix is the indentation and left-border character used for each line
// of a file content preview. The 5-space indent aligns with the tool call
// header's primary value column.
const gutterPrefix = "     │ "

// ellipsisPrefix is the indentation and vertical ellipsis character used to
// indicate that more content exists beyond the preview window. Aligned with
// the gutter column.
const ellipsisPrefix = "     ⋮ "

// formatFileContentPreview renders a multi-line gutter-bordered preview of file
// content. It shows up to filePreviewMaxLines lines with a left-border gutter,
// followed by a "N more lines" indicator when the file has additional content.
//
// Trailing blank lines within the preview window are trimmed to avoid wasting
// vertical space. If all lines in the preview window are blank, the first
// non-empty line from the full result is shown instead.
//
// The returned string includes the gutter prefixes and is ready to be wrapped
// in dimStyle.Render() by the caller.
//
// Examples:
//
//	"     │ syntax = \"proto3\";\n     │ \n     │ package ai.stigmer;\n     ⋮ 30 more lines"
//	"     │ apiVersion: v1\n     │ kind: Config"
//	""  (empty result)
func formatFileContentPreview(result string) string {
	if strings.TrimSpace(result) == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	lines := strings.Split(result, "\n")
	totalLines := len(lines)

	// Take first filePreviewMaxLines lines.
	preview := lines
	if len(preview) > filePreviewMaxLines {
		preview = preview[:filePreviewMaxLines]
	}

	// Trim trailing blank lines from the preview window to avoid wasting
	// vertical space on empty lines at the boundary.
	for len(preview) > 0 && strings.TrimSpace(preview[len(preview)-1]) == "" {
		preview = preview[:len(preview)-1]
	}

	// If all lines in the preview window were blank, fall back to the first
	// non-empty line from the full result.
	if len(preview) == 0 {
		first := firstNonEmptyLine(result)
		if first == "" {
			return ""
		}
		preview = []string{first}
	}

	// Render each preview line with the gutter prefix.
	var sb strings.Builder
	for i, line := range preview {
		if i > 0 {
			sb.WriteString("\n")
		}
		displayLine := truncate(line, previewMaxWidth-len(gutterPrefix))
		sb.WriteString(gutterPrefix + displayLine)
	}

	// Append "N more lines" indicator when the file extends beyond the preview.
	remaining := totalLines - len(preview)
	if remaining > 0 {
		sb.WriteString(fmt.Sprintf("\n%s%d more lines", ellipsisPrefix, remaining))
	}

	return sb.String()
}

// formatFullResultWithGutter renders every line of a tool result with a left
// gutter border, providing a visually bounded block for the TUI's expanded
// state. Unlike formatFileContentPreview, there is no line limit, no trailing-
// blank trimming, and no "N more lines" indicator — the full content is shown.
//
// The gutter style matches formatFileContentPreview so that expanding a block
// looks like a natural extension of the collapsed preview.
//
// Returns an empty string if the result is empty or only whitespace.
func formatFullResultWithGutter(result string) string {
	if strings.TrimSpace(result) == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	lines := strings.Split(result, "\n")

	var sb strings.Builder
	for i, line := range lines {
		if i > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(gutterPrefix + line)
	}

	return sb.String()
}

// countLines returns the number of newline-separated lines in s.
// An empty string has zero lines. A string with no newlines has one line.
func countLines(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 1
}

// formatLineCount returns a human-readable line count string.
// Uses singular "line" for exactly one line.
func formatLineCount(n int) string {
	if n == 1 {
		return "1 line"
	}
	return fmt.Sprintf("%d lines", n)
}

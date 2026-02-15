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
// content with optional syntax highlighting. It shows up to filePreviewMaxLines
// lines with a left-border gutter, followed by a "N more lines" indicator when
// the file has additional content.
//
// When filename is non-empty and matches a known language, the content is
// syntax-highlighted with ANSI escape codes. The gutter prefix is rendered in
// dim style while highlighted content retains its own coloring. When
// highlighting is unavailable, the entire line (gutter + content) is dim-styled,
// preserving the original visual appearance.
//
// Trailing blank lines within the preview window are trimmed to avoid wasting
// vertical space. If all lines in the preview window are blank, the first
// non-empty line from the full result is shown instead.
//
// The returned string is fully styled and ready to be appended to the tool
// header — callers should NOT wrap it in dimStyle.Render().
//
// Examples:
//
//	"     │ syntax = \"proto3\";\n     │ \n     │ package ai.stigmer;\n     ⋮ 30 more lines"
//	"     │ apiVersion: v1\n     │ kind: Config"
//	""  (empty result)
func formatFileContentPreview(result, filename string) string {
	if strings.TrimSpace(result) == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	lines := strings.Split(result, "\n")
	totalLines := len(lines)

	// Highlight the full content before slicing so that multi-line syntax
	// constructs (e.g., YAML multi-line strings, JSON arrays) are tokenized
	// correctly across line boundaries.
	highlighted, isHighlighted := highlightContent(result, filename)
	var hLines []string
	if isHighlighted {
		hLines = strings.Split(highlighted, "\n")
	}

	// --- Preview line selection (operates on original plain-text lines) ---

	previewEnd := min(len(lines), filePreviewMaxLines)

	// Trim trailing blank lines from the preview window to avoid wasting
	// vertical space on empty lines at the boundary.
	for previewEnd > 0 && strings.TrimSpace(lines[previewEnd-1]) == "" {
		previewEnd--
	}

	// Determine which line indices to display.
	type indexedLine struct {
		idx   int    // position in lines / hLines
		plain string // original plain text (for fallback rendering)
	}
	var display []indexedLine

	if previewEnd == 0 {
		// All lines in the preview window were blank. Fall back to the first
		// non-empty line from the full result.
		for i, l := range lines {
			if strings.TrimSpace(l) != "" {
				display = append(display, indexedLine{idx: i, plain: l})
				break
			}
		}
		if len(display) == 0 {
			return ""
		}
	} else {
		display = make([]indexedLine, previewEnd)
		for i := 0; i < previewEnd; i++ {
			display[i] = indexedLine{idx: i, plain: lines[i]}
		}
	}

	// --- Render with gutter ---

	// Pre-render the dim gutter once. When highlighted, the gutter is dim
	// but the content retains its ANSI coloring. When not highlighted, the
	// entire line is dim (matching the pre-highlighting behavior).
	styledGutter := dimStyle.Render(gutterPrefix)
	contentWidth := previewMaxWidth - len(gutterPrefix)

	var sb strings.Builder
	for i, dl := range display {
		if i > 0 {
			sb.WriteString("\n")
		}
		if isHighlighted && dl.idx < len(hLines) {
			sb.WriteString(styledGutter + truncateANSI(hLines[dl.idx], contentWidth))
		} else {
			sb.WriteString(dimStyle.Render(gutterPrefix + truncate(dl.plain, contentWidth)))
		}
	}

	// Append "N more lines" indicator when the file extends beyond the preview.
	remaining := totalLines - len(display)
	if remaining > 0 {
		sb.WriteString("\n")
		sb.WriteString(dimStyle.Render(fmt.Sprintf("%s%d more lines", ellipsisPrefix, remaining)))
	}

	return sb.String()
}

// formatFullResultWithGutter renders every line of a tool result with a left
// gutter border and optional syntax highlighting, providing a visually bounded
// block for the TUI's expanded state. Unlike formatFileContentPreview, there is
// no line limit, no trailing-blank trimming, and no "N more lines" indicator —
// the full content is shown.
//
// When filename is non-empty and matches a known language, content lines are
// syntax-highlighted. The gutter prefix is always dim-styled while content
// retains its own ANSI coloring. When highlighting is unavailable, the entire
// line is dim-styled (matching the pre-highlighting behavior).
//
// The gutter style matches formatFileContentPreview so that expanding a block
// looks like a natural extension of the collapsed preview.
//
// The returned string is fully styled — callers should NOT wrap it in
// dimStyle.Render().
//
// Returns an empty string if the result is empty or only whitespace.
func formatFullResultWithGutter(result, filename string) string {
	if strings.TrimSpace(result) == "" {
		return ""
	}

	// Defense: strip raw ToolMessage repr if backend didn't clean it.
	result = stripToolMessageRepr(result)

	// Highlight the full content.
	highlighted, isHighlighted := highlightContent(result, filename)

	var contentLines []string
	if isHighlighted {
		contentLines = strings.Split(highlighted, "\n")
	} else {
		contentLines = strings.Split(result, "\n")
	}

	styledGutter := dimStyle.Render(gutterPrefix)

	var sb strings.Builder
	for i, line := range contentLines {
		if i > 0 {
			sb.WriteString("\n")
		}
		if isHighlighted {
			sb.WriteString(styledGutter + line)
		} else {
			sb.WriteString(dimStyle.Render(gutterPrefix + line))
		}
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

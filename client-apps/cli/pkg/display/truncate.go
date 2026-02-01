// Package display provides utilities for rendering formatted output in the CLI.
// This file contains truncation utilities for presentation-layer text formatting.
package display

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/rivo/uniseg"
)

// TruncateDescription truncates description text for display in search results.
// It handles multi-line text by taking the first paragraph, preserves word
// boundaries when possible, and adds "..." when truncated.
//
// This is a presentation-layer concern - the full text comes from the backend,
// and truncation happens here based on display constraints.
func TruncateDescription(text string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}

	// Handle empty or whitespace-only text
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}

	// Take first line/paragraph for multi-line text
	text = extractFirstParagraph(text)

	// Measure using grapheme clusters for Unicode safety
	textWidth := uniseg.StringWidth(text)
	if textWidth <= maxLen {
		return text
	}

	// Need to truncate - reserve space for ellipsis
	return truncateWithWordBoundary(text, maxLen)
}

// TruncateWithEllipsis truncates text to maxLen and adds "..." if truncated.
// Unlike TruncateDescription, this does simple character truncation without
// trying to preserve word boundaries.
func TruncateWithEllipsis(text string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}
	if maxLen <= 3 {
		return "..."
	}

	textWidth := uniseg.StringWidth(text)
	if textWidth <= maxLen {
		return text
	}

	return truncateToWidth(text, maxLen-3) + "..."
}

// extractFirstParagraph extracts the first paragraph from multi-line text.
// A paragraph ends at a blank line or double newline.
func extractFirstParagraph(text string) string {
	// Check for double newline (paragraph separator)
	if idx := strings.Index(text, "\n\n"); idx != -1 {
		text = text[:idx]
	}

	// Take first line if still multi-line
	if idx := strings.Index(text, "\n"); idx != -1 {
		text = text[:idx]
	}

	return strings.TrimSpace(text)
}

// truncateWithWordBoundary truncates text at a word boundary when possible.
// Adds "..." to indicate truncation.
func truncateWithWordBoundary(text string, maxLen int) string {
	if maxLen <= 3 {
		return "..."
	}

	targetLen := maxLen - 3 // Reserve space for "..."

	// First truncate to approximate length
	truncated := truncateToWidth(text, targetLen)

	// Try to find a word boundary (space) to break at
	if lastSpace := strings.LastIndex(truncated, " "); lastSpace > targetLen/2 {
		// Only use word boundary if it's not too far back
		truncated = truncated[:lastSpace]
	}

	return strings.TrimSpace(truncated) + "..."
}

// truncateToWidth truncates text to a maximum grapheme width.
// Uses Unicode grapheme clusters for proper handling of emojis and
// combining characters.
func truncateToWidth(text string, maxWidth int) string {
	if maxWidth <= 0 {
		return ""
	}

	var result strings.Builder
	result.Grow(maxWidth + 10) // Slight over-allocation for safety

	width := 0
	graphemes := uniseg.NewGraphemes(text)

	for graphemes.Next() {
		graphemeWidth := graphemes.Width()
		if width+graphemeWidth > maxWidth {
			break
		}

		result.WriteString(graphemes.Str())
		width += graphemeWidth
	}

	return result.String()
}

// FormatRelativeTime formats a duration into a human-readable relative time.
// Examples: "2 days ago", "3 hours ago", "just now"
func FormatRelativeTime(seconds int64) string {
	if seconds < 60 {
		return "just now"
	}

	minutes := seconds / 60
	if minutes < 60 {
		return pluralize(minutes, "minute") + " ago"
	}

	hours := minutes / 60
	if hours < 24 {
		return pluralize(hours, "hour") + " ago"
	}

	days := hours / 24
	if days < 30 {
		return pluralize(days, "day") + " ago"
	}

	months := days / 30
	if months < 12 {
		return pluralize(months, "month") + " ago"
	}

	years := days / 365
	return pluralize(years, "year") + " ago"
}

// pluralize returns the singular or plural form of a word.
func pluralize(count int64, singular string) string {
	if count == 1 {
		return "1 " + singular
	}
	return fmt.Sprintf("%d %ss", count, singular)
}

// NormalizeWhitespace collapses multiple whitespace characters into single spaces
// and trims leading/trailing whitespace. Useful for cleaning up descriptions.
func NormalizeWhitespace(text string) string {
	var result strings.Builder
	result.Grow(len(text))

	inWhitespace := true // Start true to trim leading whitespace

	for _, r := range text {
		if unicode.IsSpace(r) {
			if !inWhitespace {
				result.WriteByte(' ')
				inWhitespace = true
			}
		} else {
			result.WriteRune(r)
			inWhitespace = false
		}
	}

	return strings.TrimSpace(result.String())
}

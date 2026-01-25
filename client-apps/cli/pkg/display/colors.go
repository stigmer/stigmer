// Package display provides utilities for rendering formatted output in the CLI.
// This file contains color-aware string measurement utilities inspired by Pulumi.
package display

import (
	"strings"

	"github.com/rivo/uniseg"
)

// MeasureColorizedString returns the visible width of a string that may contain ANSI color codes.
// It strips ANSI codes and measures the actual visible characters using Unicode grapheme clusters.
// This ensures proper width calculation for strings with emojis, combining characters, and colors.
func MeasureColorizedString(s string) int {
	// Strip ANSI codes first
	stripped := stripANSI(s)
	// Measure using Unicode graphemes
	return uniseg.StringWidth(stripped)
}

// TrimColorizedString trims a colorized string to a maximum visible width.
// It preserves ANSI color codes while ensuring the visible length doesn't exceed maxWidth.
// Uses Unicode grapheme clusters for proper emoji and combining character support.
func TrimColorizedString(s string, maxWidth int) string {
	if maxWidth <= 0 {
		return ""
	}

	// First, let's handle the ANSI codes properly
	result := strings.Builder{}
	result.Grow(len(s))
	
	width := 0
	inANSI := false
	
	graphemes := uniseg.NewGraphemes(s)
	for graphemes.Next() {
		runes := graphemes.Runes()
		str := string(runes)
		
		// Check if this is an ANSI escape sequence
		if strings.HasPrefix(str, "\x1b[") {
			inANSI = true
			result.WriteString(str)
			continue
		}
		
		if inANSI {
			result.WriteString(str)
			if strings.HasSuffix(str, "m") {
				inANSI = false
			}
			continue
		}
		
		// Check if adding this grapheme would exceed maxWidth
		graphemeWidth := graphemes.Width()
		if width+graphemeWidth > maxWidth {
			break
		}
		
		result.WriteString(str)
		width += graphemeWidth
	}
	
	return result.String()
}

// stripANSI removes ANSI escape sequences from a string.
// This is used internally for measuring visible width.
func stripANSI(s string) string {
	result := strings.Builder{}
	result.Grow(len(s))
	
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			i++ // Skip '['
			continue
		}
		
		if inEscape {
			if s[i] == 'm' {
				inEscape = false
			}
			continue
		}
		
		result.WriteByte(s[i])
	}
	
	return result.String()
}

// PadRight pads a colorized string with spaces to reach the target width.
// It measures the visible width (ignoring color codes) and adds appropriate padding.
func PadRight(s string, targetWidth int) string {
	currentWidth := MeasureColorizedString(s)
	if currentWidth >= targetWidth {
		return s
	}
	
	padding := strings.Repeat(" ", targetWidth-currentWidth)
	return s + padding
}

// max returns the maximum of two integers
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

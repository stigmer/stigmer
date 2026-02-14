package panel

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// wrapLine splits a single line into multiple lines that each fit within
// maxWidth visual columns. It first attempts word-level wrapping (preferring
// breaks at spaces), then hard-breaks any remaining segments that still exceed
// the limit.
//
// ANSI escape sequences (colors, bold, etc.) are handled transparently — they
// do not count toward the visual width and are preserved across line breaks.
//
// An empty input returns a single empty string so the caller always gets at
// least one row to render.
func wrapLine(text string, maxWidth int) []string {
	if maxWidth <= 0 {
		return []string{text}
	}

	// Fast path: line already fits.
	if lipgloss.Width(text) <= maxWidth {
		return []string{text}
	}

	// Word-wrap first (breaks at spaces), then hard-wrap any residual long
	// tokens that still exceed maxWidth. preserveSpace=false avoids leaving
	// a dangling space at the start of continuation lines.
	wrapped := ansi.Wordwrap(text, maxWidth, "")
	wrapped = ansi.Hardwrap(wrapped, maxWidth, false)

	return strings.Split(wrapped, "\n")
}

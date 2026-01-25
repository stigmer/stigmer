// Package display provides utilities for rendering formatted output in the CLI.
// This file contains terminal utilities for detecting terminal size and capabilities.
package display

import (
	"os"

	"golang.org/x/term"
)

const (
	// DefaultTermWidth is the fallback width when terminal size cannot be detected
	DefaultTermWidth = 120
	
	// MinTermWidth is the minimum terminal width we'll work with
	MinTermWidth = 80
)

// GetTerminalWidth returns the current terminal width in columns.
// Falls back to DefaultTermWidth if the terminal size cannot be determined.
func GetTerminalWidth() int {
	// Try to get the terminal size from stdout
	width, _, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || width <= 0 {
		// Fallback to default if detection fails
		return DefaultTermWidth
	}
	
	// Ensure we don't go below minimum
	if width < MinTermWidth {
		return MinTermWidth
	}
	
	return width
}

// IsTerminal returns true if stdout is connected to a terminal.
// This is useful for deciding whether to use colors and fancy formatting.
func IsTerminal() bool {
	return term.IsTerminal(int(os.Stdout.Fd()))
}

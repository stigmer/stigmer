// Package termctl provides low-level ANSI terminal cursor control primitives.
//
// All functions accept an io.Writer (typically os.Stderr for inline CLI
// rendering) and are safe to call with non-terminal writers — cursor control
// functions become no-ops when the writer is not a supported terminal.
//
// This package does NOT handle rendering, content layout, or business logic.
// It is a foundation for higher-level flows like approval-prompt collapse
// (erase expanded content, replace with compact summary).
package termctl

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/x/ansi"
	"golang.org/x/term"
)

// IsSupported reports whether w is a terminal that can handle ANSI cursor
// control sequences. Returns false for non-TTY writers and dumb terminals.
//
// Does NOT check NO_COLOR — cursor control is a UX mechanism (collapsing
// content after approval), not a color decoration. Users who disable color
// still benefit from cursor-controlled content management.
func IsSupported(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok || !term.IsTerminal(int(f.Fd())) {
		return false
	}
	return os.Getenv("TERM") != "dumb"
}

// MoveUp moves the cursor up n lines using ANSI CSI CUU.
// No-op when n <= 0. This guard is critical because the ANSI spec treats
// a parameter of 0 as 1 — omitting it would cause an unintended move.
func MoveUp(w io.Writer, n int) {
	if n <= 0 {
		return
	}
	fmt.Fprintf(w, "\033[%dA", n)
}

// ClearDown erases from the cursor position to the end of the screen
// using ANSI CSI ED (Erase in Display, parameter 0).
func ClearDown(w io.Writer) {
	fmt.Fprint(w, "\033[J")
}

// ClearLine erases the entire current line and moves the cursor to column 0
// using ANSI CSI EL (Erase in Line, parameter 2) followed by carriage return.
func ClearLine(w io.Writer) {
	fmt.Fprint(w, "\033[2K\r")
}

// EraseLines erases n lines of previously written output. The cursor moves
// up n-1 lines, resets to column 0, then clears from that position to the
// end of the screen. After this call the cursor sits at column 0 of the
// topmost erased line.
//
// The entire ANSI sequence is written in a single Write call to prevent
// interleaving with concurrent output on the same writer.
//
// No-op when n <= 0. When n == 1, only the current line is cleared.
func EraseLines(w io.Writer, n int) {
	if n <= 0 {
		return
	}
	if n == 1 {
		fmt.Fprint(w, "\r\033[J")
		return
	}
	fmt.Fprintf(w, "\033[%dA\r\033[J", n-1)
}

// Width returns the terminal width in columns for the writer's underlying
// file descriptor. Returns defaultWidth if w is not an *os.File, not a
// terminal, or the size cannot be determined.
func Width(w io.Writer, defaultWidth int) int {
	f, ok := w.(*os.File)
	if !ok {
		return defaultWidth
	}
	width, _, err := term.GetSize(int(f.Fd()))
	if err != nil || width <= 0 {
		return defaultWidth
	}
	return width
}

// DisplayRows calculates the number of terminal rows required to display
// text on a terminal of the given column width, accounting for line wrapping
// and ANSI escape sequences (CSI, OSC 8). A trailing newline does not add
// an extra row — it merely advances the cursor. Returns 0 for empty text
// or non-positive width.
func DisplayRows(text string, width int) int {
	if text == "" || width <= 0 {
		return 0
	}

	lines := strings.Split(text, "\n")

	// A trailing newline produces a final empty segment that does not
	// occupy a visible row — the newline merely advances the cursor.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return 0
	}

	rows := 0
	for _, line := range lines {
		visible := ansi.StringWidth(line)
		if visible == 0 {
			rows++
		} else {
			rows += (visible + width - 1) / width
		}
	}
	return rows
}

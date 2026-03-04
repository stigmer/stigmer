// Package climsg provides colored status messages for CLI ephemeral output.
//
// All output is written to stderr by default. This separates ephemeral
// status messages (progress, diagnostics) from primary command output
// on stdout, ensuring machine-readable formats like --json are never
// corrupted by interleaved status text.
//
// The package exposes two layers:
//
//   - Package-level convenience functions (Info, Error, Warning, Success)
//     that write to os.Stderr. Use these in production command handlers.
//
//   - A Writer struct created via New(w) for dependency injection and
//     testing. Tests create a Writer backed by a bytes.Buffer to capture
//     and assert output without touching global state.
package climsg

import (
	"fmt"
	"io"
	"os"

	"github.com/fatih/color"
)

var (
	infoStyle    = color.New(color.FgCyan)
	successStyle = color.New(color.FgGreen, color.Bold)
	warningStyle = color.New(color.FgYellow)
	errorStyle   = color.New(color.FgRed, color.Bold)
)

// Writer sends colored status messages to a specific io.Writer.
type Writer struct {
	out io.Writer
}

// New creates a Writer that sends messages to w.
func New(w io.Writer) *Writer {
	return &Writer{out: w}
}

func (w *Writer) Info(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	infoStyle.Fprintf(w.out, "%s\n", msg)
}

func (w *Writer) Success(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	successStyle.Fprintf(w.out, "✓ %s\n", msg)
}

func (w *Writer) Warning(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	warningStyle.Fprintf(w.out, "⚠ %s\n", msg)
}

func (w *Writer) Error(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	errorStyle.Fprintf(w.out, "✗ %s\n", msg)
}

var stderr = New(os.Stderr)

func Info(format string, args ...any)    { stderr.Info(format, args...) }
func Success(format string, args ...any) { stderr.Success(format, args...) }
func Warning(format string, args ...any) { stderr.Warning(format, args...) }
func Error(format string, args ...any)   { stderr.Error(format, args...) }

// ReplaceOutput temporarily replaces the package-level writer used by the
// convenience functions. Returns a function that restores the original writer.
// Intended for tests that need to capture climsg output.
func ReplaceOutput(w io.Writer) func() {
	original := stderr
	stderr = New(w)
	return func() { stderr = original }
}

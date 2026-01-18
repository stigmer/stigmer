package cliprint

import (
	"fmt"
	"os"
)

// Success prints a success message in green
func Success(format string, args ...interface{}) {
	fmt.Fprintf(os.Stdout, "✓ "+format+"\n", args...)
}

// Info prints an informational message
func Info(format string, args ...interface{}) {
	fmt.Fprintf(os.Stdout, format+"\n", args...)
}

// Warning prints a warning message in yellow
func Warning(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "⚠ "+format+"\n", args...)
}

// Error prints an error message in red
func Error(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "✗ "+format+"\n", args...)
}

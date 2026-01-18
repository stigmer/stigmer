package cliprint

import (
	"fmt"

	"github.com/fatih/color"
)

var (
	// SuccessColor for success messages
	SuccessColor = color.New(color.FgGreen, color.Bold)
	// ErrorColor for error messages
	ErrorColor = color.New(color.FgRed, color.Bold)
	// InfoColor for info messages
	InfoColor = color.New(color.FgCyan)
	// WarningColor for warning messages
	WarningColor = color.New(color.FgYellow)
)

// PrintSuccess prints a success message in green
func PrintSuccess(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	SuccessColor.Printf("✓ %s\n", message)
}

// PrintError prints an error message in red
func PrintError(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	ErrorColor.Printf("✗ %s\n", message)
}

// PrintInfo prints an info message in cyan
func PrintInfo(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	InfoColor.Printf("ℹ %s\n", message)
}

// PrintWarning prints a warning message in yellow
func PrintWarning(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	WarningColor.Printf("⚠ %s\n", message)
}

// Deprecated: Use PrintSuccess instead
func Success(format string, args ...interface{}) {
	PrintSuccess(format, args...)
}

// Deprecated: Use PrintInfo instead
func Info(format string, args ...interface{}) {
	PrintInfo(format, args...)
}

// Deprecated: Use PrintWarning instead
func Warning(format string, args ...interface{}) {
	PrintWarning(format, args...)
}

// Deprecated: Use PrintError instead
func Error(format string, args ...interface{}) {
	PrintError(format, args...)
}

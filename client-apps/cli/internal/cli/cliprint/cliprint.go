package cliprint

import (
	"fmt"

	"github.com/fatih/color"
)

var (
	successColor = color.New(color.FgGreen, color.Bold)
	errorColor   = color.New(color.FgRed, color.Bold)
	infoColor    = color.New(color.FgCyan)
	warningColor = color.New(color.FgYellow)
)

// PrintSuccess prints a success message in green
func PrintSuccess(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	successColor.Printf("✓ %s\n", message)
}

// PrintError prints an error message in red
func PrintError(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	errorColor.Printf("✗ %s\n", message)
}

// PrintInfo prints an info message in cyan
func PrintInfo(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	infoColor.Printf("ℹ %s\n", message)
}

// PrintWarning prints a warning message in yellow
func PrintWarning(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	warningColor.Printf("⚠ %s\n", message)
}

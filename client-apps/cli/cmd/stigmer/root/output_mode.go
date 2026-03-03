package root

import (
	"github.com/spf13/cobra"
)

// OutputMode determines how agent execution events are rendered to the user.
type OutputMode int

const (
	// OutputInteractive renders events in a Bubbletea alt-screen TUI with
	// scrollable viewport, inline approval handling, and follow-up input.
	// Retained for potential future use but not reachable from CLI flags.
	OutputInteractive OutputMode = iota

	// OutputInline streams events directly to the terminal without
	// alt-screen. AI content goes to stdout (pipeable), status/progress
	// goes to stderr. Colors are preserved when stdout is a TTY.
	// This is the default for all interactive and non-interactive contexts.
	OutputInline

	// OutputJSON emits every event as a newline-delimited JSON object on
	// stdout. Intended for scripting, CI pipelines, and tool integration.
	OutputJSON
)

// outputModeFlags holds the raw flag values for output mode selection.
// Registered on commands that support agent execution streaming (run, draft)
// and resolved into an OutputMode via resolveOutputMode.
type outputModeFlags struct {
	JSON bool
}

// registerOutputModeFlags adds the --json flag to the command.
func registerOutputModeFlags(cmd *cobra.Command, f *outputModeFlags) {
	cmd.Flags().BoolVar(&f.JSON, "json", false,
		"stream execution events as newline-delimited JSON (for scripting/CI)")
}

// resolveOutputMode determines the output mode from flags.
// --json selects JSON output; everything else is inline.
func resolveOutputMode(flags outputModeFlags) OutputMode {
	if flags.JSON {
		return OutputJSON
	}
	return OutputInline
}

func (m OutputMode) String() string {
	switch m {
	case OutputInteractive:
		return "interactive"
	case OutputInline:
		return "inline"
	case OutputJSON:
		return "json"
	default:
		return "unknown"
	}
}

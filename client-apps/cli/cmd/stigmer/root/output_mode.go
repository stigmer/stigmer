package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// OutputMode determines how agent execution events are rendered to the user.
type OutputMode int

const (
	// OutputInteractive renders events in a Bubbletea alt-screen TUI with
	// scrollable viewport, inline approval handling, and follow-up input.
	// This is the default when stdout is connected to a capable terminal.
	OutputInteractive OutputMode = iota

	// OutputInline streams events directly to the terminal without
	// alt-screen. AI content goes to stdout (pipeable), status/progress
	// goes to stderr. Colors are preserved when stdout is a TTY.
	OutputInline

	// OutputJSON emits every event as a newline-delimited JSON object on
	// stdout. Intended for scripting, CI pipelines, and tool integration.
	OutputJSON
)

// outputModeFlags holds the raw flag values for output mode selection.
// These are registered on commands that support agent execution streaming
// (run, draft) and resolved into an OutputMode via resolveOutputMode.
type outputModeFlags struct {
	JSON  bool
	NoTUI bool
}

// registerOutputModeFlags adds --json and --no-tui flags to the command.
// The two flags are mutually exclusive: --json implies non-interactive
// output, so combining them with --no-tui is redundant and confusing.
func registerOutputModeFlags(cmd *cobra.Command, f *outputModeFlags) {
	cmd.Flags().BoolVar(&f.JSON, "json", false,
		"stream execution events as newline-delimited JSON (for scripting/CI)")

	cmd.Flags().BoolVar(&f.NoTUI, "no-tui", false,
		"stream output inline without the interactive TUI (preserves scrollback)")

	cmd.MarkFlagsMutuallyExclusive("json", "no-tui")
}

// resolveOutputMode determines the output mode from flags and terminal
// environment. The precedence (highest to lowest) is:
//
//  1. --json flag          → OutputJSON
//  2. --no-tui flag        → OutputInline
//  3. stdout is not a TTY  → OutputInline (auto-detected)
//  4. TERM=dumb            → OutputInline (auto-detected)
//  5. default (TTY)        → OutputInteractive
func resolveOutputMode(flags outputModeFlags) OutputMode {
	if flags.JSON {
		return OutputJSON
	}
	if flags.NoTUI {
		return OutputInline
	}
	if !display.IsTerminal() {
		return OutputInline
	}
	if os.Getenv("TERM") == "dumb" {
		return OutputInline
	}
	return OutputInteractive
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

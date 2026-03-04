package root

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
)

// NewFixCommand creates the `stigmer fix` escape hatch command that restores
// terminal sanity after an unclean TUI exit. Designed to be typed blind
// when the terminal is stuck in alt-screen or raw mode.
func NewFixCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "fix",
		Short: "Restore terminal state after an unclean TUI exit",
		Long: `Restore the terminal to a usable state when it has been left
in a broken state (invisible cursor, no echo, garbled output) by an
unclean exit of the execution TUI.

This is an escape hatch — normally the TUI restores the terminal
automatically, even on crashes and signals. Use this command only if
your terminal is visibly broken after a stigmer session.

You can type this command blind if you cannot see your input.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return fixTerminal()
		},
	}
}

// fixTerminal restores the terminal to a clean state by applying ANSI
// reset sequences and resetting the terminal driver to cooked mode
// via stty sane.
func fixTerminal() error {
	// ANSI sequences: exit alt-screen, show cursor, reset attributes,
	// reset scrolling region.
	fmt.Fprint(os.Stdout, "\033[?1049l\033[?25h\033[0m\033[r")

	// stty sane resets the terminal driver to a well-known cooked state:
	// enables echo, line buffering, signal processing, etc. This works
	// even when the terminal is stuck in raw mode (where Go's term.MakeRaw
	// + term.Restore cycle would just save and re-apply the broken state).
	sane := exec.Command("stty", "sane")
	sane.Stdin = os.Stdin
	_ = sane.Run()

	fmt.Fprintln(os.Stderr, "Terminal restored.")
	return nil
}

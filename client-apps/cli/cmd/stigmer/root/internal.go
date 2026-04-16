package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewInternalDaemonCommand creates a hidden command that runs the long-lived
// daemon process. This is the single lifecycle owner for all components.
func NewInternalDaemonCommand() *cobra.Command {
	return &cobra.Command{
		Use:    "internal-daemon",
		Hidden: true,
		Short:  "Internal: Long-lived daemon process (starts and monitors all components)",
		Run: func(cmd *cobra.Command, args []string) {
			if err := daemon.RunDaemonProcess(); err != nil {
				os.Exit(1)
			}
		},
	}
}

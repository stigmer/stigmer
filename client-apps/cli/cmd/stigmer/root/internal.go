package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/server"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/runner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewInternalServerCommand creates a hidden command that runs stigmer-server
// This is used by the daemon to spawn the server as a subprocess
func NewInternalServerCommand() *cobra.Command {
	return &cobra.Command{
		Use:    "internal-server",
		Hidden: true,
		Short:  "Internal: Start stigmer-server (used by daemon)",
		Run: func(cmd *cobra.Command, args []string) {
			if err := server.Run(); err != nil {
				os.Exit(1)
			}
		},
	}
}

// NewInternalWorkflowRunnerCommand creates a hidden command that runs workflow-runner
// This is used by the daemon to spawn the workflow-runner as a subprocess
func NewInternalWorkflowRunnerCommand() *cobra.Command {
	return &cobra.Command{
		Use:    "internal-workflow-runner",
		Hidden: true,
		Short:  "Internal: Start workflow-runner (used by daemon)",
		Run: func(cmd *cobra.Command, args []string) {
			if err := runner.Run(); err != nil {
				os.Exit(1)
			}
		},
	}
}

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

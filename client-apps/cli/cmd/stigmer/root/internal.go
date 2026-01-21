package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/server"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/runner"
)

// NewInternalServerCommand creates a hidden command that runs stigmer-server
// This is used by the daemon to spawn the server as a subprocess
func NewInternalServerCommand() *cobra.Command {
	return &cobra.Command{
		Use:    "internal-server",
		Hidden: true, // Don't show to users
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
		Hidden: true, // Don't show to users
		Short:  "Internal: Start workflow-runner (used by daemon)",
		Run: func(cmd *cobra.Command, args []string) {
			if err := runner.Run(); err != nil {
				os.Exit(1)
			}
		},
	}
}

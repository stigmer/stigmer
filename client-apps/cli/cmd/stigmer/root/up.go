package root

import (
	"github.com/spf13/cobra"
)

// NewUpCommand creates the 'stigmer up' command.
// Starts the full local development stack by default.
func NewUpCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "up",
		Short: "Start the local development stack",
		Long: `Start the complete local Stigmer stack: Temporal, stigmer-server,
and an embedded execution worker. This is the quickstart command for
local development — no cloud account needed.

Use 'stigmer up server' as an explicit alias.`,
		Example: `  # Start the full local stack
  stigmer up

  # Start with the web console open
  stigmer up --open

  # Start in sandbox execution mode
  stigmer up --execution-mode sandbox

  # Start without the web console
  stigmer up --no-web`,
		Run: func(cmd *cobra.Command, args []string) {
			prepareAndStartServer(cmd, resolveResultFormat(jsonOutput, quietOutput), false)
		},
	}

	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")
	cmd.Flags().String("activity-routing", "", "Activity routing mode: global or session (default: global)")
	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newUpServerCommand())

	return cmd
}

func newUpServerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start the full local development stack",
		Long: `Start the complete local Stigmer stack: Temporal, stigmer-server,
and an embedded execution worker. This is the quickstart command for
local development — no cloud account needed.`,
		Example: `  # Start the full local stack
  stigmer up server

  # Start with the web console open
  stigmer up server --open

  # Start in sandbox execution mode
  stigmer up server --execution-mode sandbox

  # Start without the web console
  stigmer up server --no-web`,
		Run: func(cmd *cobra.Command, args []string) {
			prepareAndStartServer(cmd, resolveResultFormat(jsonOutput, quietOutput), false)
		},
	}

	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")
	cmd.Flags().String("activity-routing", "", "Activity routing mode: global or session (default: global)")
	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

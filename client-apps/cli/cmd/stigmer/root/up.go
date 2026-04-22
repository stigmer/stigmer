package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewUpCommand creates the 'stigmer up' command for starting services.
func NewUpCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "up",
		Short: "Start Stigmer services",
		Long: `Start Stigmer services with smart defaults.

In local mode (default), starts the full Stigmer stack: Temporal,
stigmer-server, and agent-runner.

In cloud mode, standalone runner support is coming in a future release.

Use 'stigmer up server' to start only the control plane without runners.
Use 'stigmer up runner' to start a standalone runner (coming soon).`,
		Example: `  # Start everything (server + runner)
  stigmer up

  # Start with the web console open
  stigmer up --open

  # Start in sandbox execution mode
  stigmer up --execution-mode sandbox

  # Start only the control plane
  stigmer up server`,
		Run: func(cmd *cobra.Command, args []string) {
			handleUpDefault(cmd, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")
	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newUpServerCommand())
	cmd.AddCommand(newUpRunnerCommand())

	return cmd
}

func handleUpDefault(cmd *cobra.Command, format clioutput.OutputFormat) {
	cfg, err := config.Load()
	if err != nil {
		climsg.Warning("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	if cfg.IsCloudMode() {
		climsg.Info("Cloud backend is active.")
		climsg.Info("Standalone runner mode is not yet available.")
		climsg.Info("")
		climsg.Info("To start a local development server:")
		climsg.Info("  stigmer config backend set local")
		climsg.Info("  stigmer up")
		return
	}

	prepareAndStartServer(cmd, format, false)
}

func newUpServerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start the control plane only",
		Long: `Start only the Stigmer control plane (Temporal + stigmer-server)
without any runners. Use this when you want to manage runners
independently with 'stigmer up runner'.`,
		Example: `  # Start control plane only
  stigmer up server

  # Start without the web console
  stigmer up server --no-web`,
		Run: func(cmd *cobra.Command, args []string) {
			prepareAndStartServer(cmd, resolveResultFormat(jsonOutput, quietOutput), true)
		},
	}

	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

func newUpRunnerCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "runner",
		Short: "Start a standalone runner",
		Long: `Start a standalone agent runner process.

This feature is coming in a future release. It will allow you to register
your local machine as a runner connected to either a local or cloud backend.`,
		Run: func(cmd *cobra.Command, args []string) {
			climsg.Info("Standalone runner mode is not yet available.")
			climsg.Info("It will be available in a future release.")
			climsg.Info("")
			climsg.Info("To start the full stack (server + runner):")
			climsg.Info("  stigmer up")
		},
	}

	cmd.Flags().String("name", "", "Runner name (default: hostname)")
	cmd.Flags().String("backend", "", "Backend endpoint to connect to (auto-detected by default)")

	return cmd
}

package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewInitCommand creates the init command
func NewInitCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Initialize Stigmer local backend",
		Long: `Initialize Stigmer local backend with BadgerDB storage.

This command:
  1. Creates ~/.stigmer directory
  2. Creates default configuration
  3. Starts the local daemon (stigmer-server)

The daemon runs on localhost:50051 and manages:
  - API server (gRPC)
  - BadgerDB storage
  - Workflow runner
  - Agent runner`,
		Example: `  # Initialize and start local backend
  stigmer init`,
		Run: func(cmd *cobra.Command, args []string) {
			handleInit()
		},
	}
}

func handleInit() {
	cliprint.Info("Initializing Stigmer local backend...")

	// Check if already initialized
	if config.IsInitialized() {
		cliprint.Warning("Stigmer is already initialized")
		cliprint.Info("")
		cliprint.Info("Configuration: %s", mustGetConfigPath())
		cliprint.Info("")
		cliprint.Info("To reconfigure:")
		cliprint.Info("  stigmer backend set local")
		cliprint.Info("  stigmer backend set cloud")
		return
	}

	// Create default config
	cfg := config.GetDefault()
	if err := config.Save(cfg); err != nil {
		cliprint.Error("Failed to create configuration")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Created configuration at %s", mustGetConfigPath())

	// Create data directory
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Start daemon
	cliprint.Info("Starting local daemon...")
	if err := daemon.Start(dataDir); err != nil {
		cliprint.Error("Failed to start daemon")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Daemon started on localhost:%d", daemon.DaemonPort)
	cliprint.Info("")
	cliprint.Success("Stigmer initialized successfully!")
	cliprint.Info("")
	cliprint.Info("Next steps:")
	cliprint.Info("  1. Create an agent:")
	cliprint.Info("     stigmer agent create my-agent")
	cliprint.Info("")
	cliprint.Info("  2. Create a workflow:")
	cliprint.Info("     stigmer workflow create my-workflow")
	cliprint.Info("")
	cliprint.Info("  3. Check daemon status:")
	cliprint.Info("     stigmer local status")
	cliprint.Info("")
	cliprint.Info("Data directory: %s", dataDir)
	cliprint.Info("Daemon logs:    %s/logs/", dataDir)
}

func mustGetConfigPath() string {
	path, _ := config.GetConfigPath()
	return path
}

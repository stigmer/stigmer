package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewServerCommand creates the server command for daemon management
func NewServerCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start Stigmer server",
		Long: `Start the Stigmer server in local mode.

This command starts the Stigmer server with zero configuration:
  - Auto-downloads and starts Temporal
  - Uses Ollama (local LLM, no API keys)
  - Starts stigmer-server on localhost:50051
  - Starts agent-runner for AI agent execution

Just run 'stigmer server' and start building!`,
		Run: func(cmd *cobra.Command, args []string) {
			// Default action: start the server
			handleServerStart()
		},
	}

	cmd.AddCommand(newServerStopCommand())
	cmd.AddCommand(newServerStatusCommand())
	cmd.AddCommand(newServerRestartCommand())
	cmd.AddCommand(newServerLogsCommand())

	return cmd
}

func newServerStopCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the Stigmer server",
		Run: func(cmd *cobra.Command, args []string) {
			handleServerStop()
		},
	}
}

func newServerStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show server status",
		Run: func(cmd *cobra.Command, args []string) {
			handleServerStatus()
		},
	}
}

func newServerRestartCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "restart",
		Short: "Restart the Stigmer server",
		Run: func(cmd *cobra.Command, args []string) {
			handleServerRestart()
		},
	}
}

func handleServerStart() {
	// Auto-initialize config if needed
	if !config.IsInitialized() {
		cliprint.PrintInfo("First-time setup: Initializing Stigmer...")
		
		// Create default config
		cfg := config.GetDefault()
		if err := config.Save(cfg); err != nil {
			cliprint.PrintError("Failed to create configuration")
			clierr.Handle(err)
			return
		}
		
		configPath, _ := config.GetConfigPath()
		cliprint.PrintSuccess("Created configuration at %s", configPath)
	}

	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.PrintError("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Check if already running
	if daemon.IsRunning(dataDir) {
		cliprint.PrintInfo("Server is already running")
		running, pid := daemon.GetStatus(dataDir)
		if running {
			cliprint.PrintInfo("  PID:  %d", pid)
			cliprint.PrintInfo("  Port: %d", daemon.DaemonPort)
		}
		return
	}

	cliprint.PrintInfo("Starting Stigmer server...")
	
	// Create progress display
	progress := cliprint.NewProgressDisplay()
	progress.Start()
	progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")
	
	// Start daemon with progress tracking
	if err := daemon.StartWithOptions(dataDir, daemon.StartOptions{Progress: progress}); err != nil {
		progress.Stop()
		cliprint.PrintError("Failed to start server")
		clierr.Handle(err)
		return
	}
	
	// Mark as complete
	progress.CompletePhase(cliprint.PhaseDeploying)
	progress.Stop()

	// Show success message
	cliprint.PrintSuccess("Ready! Stigmer server is running")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.PrintInfo("  PID:  %d", pid)
		cliprint.PrintInfo("  Port: %d", daemon.DaemonPort)
		cliprint.PrintInfo("  Data: %s", dataDir)
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Temporal UI: http://localhost:8233")
	}
}

func handleServerStop() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Check if running
	if !daemon.IsRunning(dataDir) {
		cliprint.Info("Server is not running")
		return
	}

	cliprint.Info("Stopping server...")
	if err := daemon.Stop(dataDir); err != nil {
		cliprint.Error("Failed to stop server")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Server stopped successfully")
}

func handleServerStatus() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	running, pid := daemon.GetStatus(dataDir)
	
	fmt.Println("Stigmer Server Status:")
	fmt.Println("─────────────────────────────────────")
	if running {
		cliprint.Info("  Status: ✓ Running")
		cliprint.Info("  PID:    %d", pid)
		cliprint.Info("  Port:   %d", daemon.DaemonPort)
		cliprint.Info("  Data:   %s", dataDir)
		cliprint.Info("")
		cliprint.Info("Temporal UI: http://localhost:8233")
	} else {
		cliprint.Warning("  Status: ✗ Stopped")
		cliprint.Info("")
		cliprint.Info("To start:")
		cliprint.Info("  stigmer server")
	}
}

func handleServerRestart() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Stop if running
	if daemon.IsRunning(dataDir) {
		cliprint.Info("Stopping server...")
		if err := daemon.Stop(dataDir); err != nil {
			cliprint.Error("Failed to stop server")
			clierr.Handle(err)
			return
		}
	}

	// Start
	cliprint.Info("Starting server...")
	if err := daemon.Start(dataDir); err != nil {
		cliprint.Error("Failed to start server")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Server restarted successfully")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.Info("  PID:  %d", pid)
		cliprint.Info("  Port: %d", daemon.DaemonPort)
	}
}

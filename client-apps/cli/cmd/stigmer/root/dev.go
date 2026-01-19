package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewDevCommand creates the dev command for daemon management
func NewDevCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "dev",
		Short: "Start development mode",
		Long: `Start the Stigmer development daemon.

This command starts the local daemon with zero configuration:
  - Auto-downloads and starts Temporal
  - Uses Ollama (local LLM, no API keys)
  - Starts stigmer-server on localhost:50051
  - Starts agent-runner for AI agent execution

Just run 'stigmer dev' and start building!`,
		Run: func(cmd *cobra.Command, args []string) {
			// Default action: start the daemon
			handleDevStart()
		},
	}

	cmd.AddCommand(newDevStopCommand())
	cmd.AddCommand(newDevStatusCommand())
	cmd.AddCommand(newDevRestartCommand())

	return cmd
}

func newDevStopCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the development daemon",
		Run: func(cmd *cobra.Command, args []string) {
			handleDevStop()
		},
	}
}

func newDevStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show daemon status",
		Run: func(cmd *cobra.Command, args []string) {
			handleDevStatus()
		},
	}
}

func newDevRestartCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "restart",
		Short: "Restart the development daemon",
		Run: func(cmd *cobra.Command, args []string) {
			handleDevRestart()
		},
	}
}

func handleDevStart() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Check if already running
	if daemon.IsRunning(dataDir) {
		cliprint.Info("Daemon is already running")
		running, pid := daemon.GetStatus(dataDir)
		if running {
			cliprint.Info("  PID:  %d", pid)
			cliprint.Info("  Port: %d", daemon.DaemonPort)
		}
		return
	}

	cliprint.Info("Starting development mode...")
	if err := daemon.Start(dataDir); err != nil {
		cliprint.Error("Failed to start daemon")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Ready! Stigmer is running")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.Info("  PID:  %d", pid)
		cliprint.Info("  Port: %d", daemon.DaemonPort)
		cliprint.Info("  Data: %s", dataDir)
	}
}

func handleDevStop() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Check if running
	if !daemon.IsRunning(dataDir) {
		cliprint.Info("Daemon is not running")
		return
	}

	cliprint.Info("Stopping daemon...")
	if err := daemon.Stop(dataDir); err != nil {
		cliprint.Error("Failed to stop daemon")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Daemon stopped successfully")
}

func handleDevStatus() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	running, pid := daemon.GetStatus(dataDir)
	
	fmt.Println("Stigmer Development Status:")
	fmt.Println("─────────────────────────────────────")
	if running {
		cliprint.Info("  Status: ✓ Running")
		cliprint.Info("  PID:    %d", pid)
		cliprint.Info("  Port:   %d", daemon.DaemonPort)
		cliprint.Info("  Data:   %s", dataDir)
	} else {
		cliprint.Warning("  Status: ✗ Stopped")
		cliprint.Info("")
		cliprint.Info("To start:")
		cliprint.Info("  stigmer dev")
	}
}

func handleDevRestart() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Stop if running
	if daemon.IsRunning(dataDir) {
		cliprint.Info("Stopping daemon...")
		if err := daemon.Stop(dataDir); err != nil {
			cliprint.Error("Failed to stop daemon")
			clierr.Handle(err)
			return
		}
	}

	// Start
	cliprint.Info("Starting daemon...")
	if err := daemon.Start(dataDir); err != nil {
		cliprint.Error("Failed to start daemon")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Daemon restarted successfully")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.Info("  PID:  %d", pid)
		cliprint.Info("  Port: %d", daemon.DaemonPort)
	}
}

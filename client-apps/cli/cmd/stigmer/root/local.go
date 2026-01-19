package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewLocalCommand creates the local command for daemon management
func NewLocalCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "local",
		Short: "Start local mode",
		Long: `Start the Stigmer local daemon.

This command starts the local daemon with zero configuration:
  - Auto-downloads and starts Temporal
  - Uses Ollama (local LLM, no API keys)
  - Starts stigmer-server on localhost:50051
  - Starts agent-runner for AI agent execution

Just run 'stigmer local' and start building!`,
		Run: func(cmd *cobra.Command, args []string) {
			// Default action: start the daemon
			handleLocalStart()
		},
	}

	cmd.AddCommand(newLocalStopCommand())
	cmd.AddCommand(newLocalStatusCommand())
	cmd.AddCommand(newLocalRestartCommand())

	return cmd
}

func newLocalStopCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the local daemon",
		Run: func(cmd *cobra.Command, args []string) {
			handleLocalStop()
		},
	}
}

func newLocalStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show daemon status",
		Run: func(cmd *cobra.Command, args []string) {
			handleLocalStatus()
		},
	}
}

func newLocalRestartCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "restart",
		Short: "Restart the local daemon",
		Run: func(cmd *cobra.Command, args []string) {
			handleLocalRestart()
		},
	}
}

func handleLocalStart() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.PrintError("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	// Check if already running
	if daemon.IsRunning(dataDir) {
		cliprint.PrintInfo("Daemon is already running")
		running, pid := daemon.GetStatus(dataDir)
		if running {
			cliprint.PrintInfo("  PID:  %d", pid)
			cliprint.PrintInfo("  Port: %d", daemon.DaemonPort)
		}
		return
	}

	cliprint.PrintInfo("Starting local mode...")
	
	// Create progress display
	progress := cliprint.NewProgressDisplay()
	progress.Start()
	progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")
	
	// Start daemon with progress tracking
	if err := daemon.StartWithOptions(dataDir, daemon.StartOptions{Progress: progress}); err != nil {
		progress.Stop()
		cliprint.PrintError("Failed to start daemon")
		clierr.Handle(err)
		return
	}
	
	// Mark as complete
	progress.CompletePhase(cliprint.PhaseDeploying)
	progress.Stop()

	// Show success message
	cliprint.PrintSuccess("Ready! Stigmer is running")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.PrintInfo("  PID:  %d", pid)
		cliprint.PrintInfo("  Port: %d", daemon.DaemonPort)
		cliprint.PrintInfo("  Data: %s", dataDir)
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Temporal UI: http://localhost:8233")
	}
}

func handleLocalStop() {
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

func handleLocalStatus() {
	dataDir, err := config.GetDataDir()
	if err != nil {
		cliprint.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	running, pid := daemon.GetStatus(dataDir)
	
	fmt.Println("Stigmer Local Status:")
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
		cliprint.Info("  stigmer local")
	}
}

func handleLocalRestart() {
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

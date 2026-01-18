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
		Short: "Manage local daemon",
		Long: `Manage the local stigmer-server daemon.

The daemon runs on localhost:50051 and provides:
  - gRPC API server
  - BadgerDB storage
  - Workflow runner (embedded)
  - Agent runner (subprocess)`,
	}

	cmd.AddCommand(newLocalStartCommand())
	cmd.AddCommand(newLocalStopCommand())
	cmd.AddCommand(newLocalStatusCommand())
	cmd.AddCommand(newLocalRestartCommand())

	return cmd
}

func newLocalStartCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the local daemon",
		Run: func(cmd *cobra.Command, args []string) {
			handleLocalStart()
		},
	}
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

	cliprint.Info("Starting daemon...")
	if err := daemon.Start(dataDir); err != nil {
		cliprint.Error("Failed to start daemon")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Daemon started successfully")
	running, pid := daemon.GetStatus(dataDir)
	if running {
		cliprint.Info("  PID:  %d", pid)
		cliprint.Info("  Port: %d", daemon.DaemonPort)
		cliprint.Info("  Data: %s", dataDir)
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
	
	fmt.Println("Daemon Status:")
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
		cliprint.Info("  stigmer local start")
		cliprint.Info("")
		cliprint.Info("Or initialize:")
		cliprint.Info("  stigmer init")
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

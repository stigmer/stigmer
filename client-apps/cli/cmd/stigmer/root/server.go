package root

import (
	"fmt"
	"time"

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
			handleServerStart(cmd)
		},
	}

	// Add execution mode flags (cascades: CLI flag > env var > config file > default)
	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode (default: ghcr.io/stigmer/agent-sandbox-basic:latest)")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")

	cmd.AddCommand(newServerStopCommand())
	cmd.AddCommand(newServerStatusCommand())
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

func handleServerStart(cmd *cobra.Command) {
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

	// If already running, stop it first (makes 'start' idempotent)
	// This eliminates the need for a separate 'restart' command
	if daemon.IsRunning(dataDir) {
		cliprint.PrintInfo("Server is already running, restarting...")
		if err := daemon.Stop(dataDir); err != nil {
			cliprint.PrintWarning("Failed to stop existing server: %v", err)
			cliprint.PrintInfo("Will attempt to start anyway (cleanup will handle orphans)")
		}
		
		// Brief pause to let processes fully terminate
		time.Sleep(1 * time.Second)
	}

	cliprint.PrintInfo("Starting Stigmer server...")
	
	// Create progress display
	progress := cliprint.NewProgressDisplay()
	progress.Start()
	progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")
	
	// Parse CLI flags for execution configuration
	executionMode, _ := cmd.Flags().GetString("execution-mode")
	sandboxImage, _ := cmd.Flags().GetString("sandbox-image")
	sandboxAutoPull, _ := cmd.Flags().GetBool("sandbox-auto-pull")
	sandboxCleanup, _ := cmd.Flags().GetBool("sandbox-cleanup")
	sandboxTTL, _ := cmd.Flags().GetInt("sandbox-ttl")
	
	// Start daemon with progress tracking and execution options
	if err := daemon.StartWithOptions(dataDir, daemon.StartOptions{
		Progress:        progress,
		ExecutionMode:   executionMode,
		SandboxImage:    sandboxImage,
		SandboxAutoPull: sandboxAutoPull,
		SandboxCleanup:  sandboxCleanup,
		SandboxTTL:      sandboxTTL,
	}); err != nil {
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
		cliprint.PrintInfo("Web UI:")
		cliprint.PrintInfo("  Temporal:  http://localhost:8233")
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
		cliprint.Info("Web UI:")
		cliprint.Info("  Temporal:  http://localhost:8233")
	} else {
		cliprint.Warning("  Status: ✗ Stopped")
		cliprint.Info("")
		cliprint.Info("To start:")
		cliprint.Info("  stigmer server")
	}
}


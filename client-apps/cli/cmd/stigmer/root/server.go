package root

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/llm"
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
	cmd.AddCommand(newServerLLMCommand())

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

func newServerLLMCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "llm",
		Short: "Manage local LLM models",
		Long: `Manage local LLM models and configuration.
		
This command allows you to:
- List available models
- Pull new models
- Switch between models
- Check LLM provider status`,
	}

	cmd.AddCommand(newServerLLMListCommand())
	cmd.AddCommand(newServerLLMPullCommand())
	cmd.AddCommand(newServerLLMStatusCommand())

	return cmd
}

func newServerLLMListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List available models",
		Run: func(cmd *cobra.Command, args []string) {
			handleLLMList()
		},
	}
}

func newServerLLMPullCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "pull MODEL",
		Short: "Pull a new model",
		Long: `Pull a new model from the LLM provider.

Examples:
  stigmer server llm pull codellama:7b
  stigmer server llm pull deepseek-coder:6.7b`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleLLMPull(args[0])
		},
	}
}

func newServerLLMStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show LLM provider status",
		Run: func(cmd *cobra.Command, args []string) {
			showLLMStatus()
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
		// Get health summary if monitoring is active
		healthSummary := daemon.GetHealthSummary()
		
		// Stigmer Server
		showComponentStatus("Stigmer Server", healthSummary["stigmer-server"], pid)
		
		// Workflow Runner
		if wfPID, err := daemon.GetWorkflowRunnerPID(dataDir); err == nil {
			showComponentStatus("Workflow Runner", healthSummary["workflow-runner"], wfPID)
		}
		
		// Agent Runner
		if containerID, err := daemon.GetAgentRunnerContainerID(dataDir); err == nil {
			showAgentRunnerStatus(healthSummary["agent-runner"], containerID)
		}
		
		cliprint.Info("")
		cliprint.Info("Server Details:")
		cliprint.Info("  Port:   %d", daemon.DaemonPort)
		cliprint.Info("  Data:   %s", dataDir)
		cliprint.Info("")
		
		// Show LLM status
		showLLMStatus()
		
		cliprint.Info("")
		cliprint.Info("Web UI:")
		cliprint.Info("  Temporal:  http://localhost:8233")
		
		// Show health monitoring status
		if len(healthSummary) > 0 {
			cliprint.Info("")
			cliprint.Info("Health Monitoring: ✓ Active")
		}
	} else {
		cliprint.Warning("  Status: ✗ Stopped")
		cliprint.Info("")
		cliprint.Info("To start:")
		cliprint.Info("  stigmer server")
	}
}

// showComponentStatus displays status for a process-based component
func showComponentStatus(name string, health daemon.ComponentHealth, pid int) {
	fmt.Printf("\n%s:\n", name)
	
	// Determine health symbol
	healthSymbol := getHealthSymbol(health.State)
	
	cliprint.Info("  Status:   %s %s", getStateDisplay(health.State), healthSymbol)
	cliprint.Info("  PID:      %d", pid)
	
	// Show uptime if running
	if !health.StartTime.IsZero() {
		uptime := time.Since(health.StartTime)
		cliprint.Info("  Uptime:   %s", formatDuration(uptime))
	}
	
	// Show restart count if any restarts occurred
	if health.RestartCount > 0 {
		cliprint.Warning("  Restarts: %d", health.RestartCount)
		if !health.LastRestart.IsZero() {
			cliprint.Info("  Last Restart: %s ago", formatDuration(time.Since(health.LastRestart)))
		}
	} else {
		cliprint.Info("  Restarts: 0")
	}
	
	// Show last error if unhealthy
	if health.State == "unhealthy" && health.LastError != nil {
		cliprint.Warning("  Last Error: %v", health.LastError)
	}
}

// showAgentRunnerStatus displays status for Docker-based agent-runner
func showAgentRunnerStatus(health daemon.ComponentHealth, containerID string) {
	fmt.Printf("\nAgent Runner (Docker):\n")
	
	healthSymbol := getHealthSymbol(health.State)
	
	cliprint.Info("  Status:   %s %s", getStateDisplay(health.State), healthSymbol)
	
	if len(containerID) > 12 {
		cliprint.Info("  Container: %s", containerID[:12])
	} else {
		cliprint.Info("  Container: %s", containerID)
	}
	
	if !health.StartTime.IsZero() {
		uptime := time.Since(health.StartTime)
		cliprint.Info("  Uptime:   %s", formatDuration(uptime))
	}
	
	if health.RestartCount > 0 {
		cliprint.Warning("  Restarts: %d", health.RestartCount)
	} else {
		cliprint.Info("  Restarts: 0")
	}
	
	if health.State == "unhealthy" && health.LastError != nil {
		cliprint.Warning("  Last Error: %v", health.LastError)
	}
}

// getStateDisplay returns a user-friendly display string for component state
func getStateDisplay(state daemon.ComponentState) string {
	switch state {
	case "running":
		return "Running"
	case "starting":
		return "Starting"
	case "unhealthy":
		return "Unhealthy"
	case "restarting":
		return "Restarting"
	case "stopped":
		return "Stopped"
	case "failed":
		return "Failed"
	default:
		return string(state)
	}
}

// getHealthSymbol returns a visual indicator for health state
func getHealthSymbol(state daemon.ComponentState) string {
	switch state {
	case "running":
		return "✓"
	case "starting":
		return "↻"
	case "unhealthy":
		return "✗"
	case "restarting":
		return "↻"
	case "stopped":
		return "○"
	case "failed":
		return "✗✗"
	default:
		return "?"
	}
}

// formatDuration formats a duration in a human-readable way
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	} else if d < time.Hour {
		minutes := int(d.Minutes())
		seconds := int(d.Seconds()) % 60
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	} else if d < 24*time.Hour {
		hours := int(d.Hours())
		minutes := int(d.Minutes()) % 60
		return fmt.Sprintf("%dh %dm", hours, minutes)
	} else {
		days := int(d.Hours()) / 24
		hours := int(d.Hours()) % 24
		return fmt.Sprintf("%dd %dh", days, hours)
	}
}

// showLLMStatus displays the current LLM configuration and status
func showLLMStatus() {
	// Load config to show provider
	cfg, err := config.Load()
	if err != nil {
		cliprint.Warning("  LLM:    Unable to load configuration")
		return
	}

	provider := cfg.Backend.Local.ResolveLLMProvider()
	model := cfg.Backend.Local.ResolveLLMModel()

	cliprint.Info("LLM Configuration:")
	
	switch provider {
	case "ollama":
		// Check local LLM status
		running, pid, models, err := llm.GetStatus()
		if err != nil {
			cliprint.Warning("  Provider: Local (Error: %v)", err)
			return
		}

		if running {
			cliprint.Info("  Provider: Local ✓ Running")
			if pid > 0 {
				cliprint.Info("  PID:      %d", pid)
			}
			cliprint.Info("  Model:    %s", model)
			
			if len(models) > 0 {
				cliprint.Info("  Available: %s", strings.Join(models, ", "))
			}
		} else {
			cliprint.Warning("  Provider: Local ✗ Not Running")
			cliprint.Info("  Model:    %s (will be downloaded on first use)", model)
		}

	case "anthropic":
		cliprint.Info("  Provider: Anthropic (Cloud)")
		cliprint.Info("  Model:    %s", model)
		
		// Check if API key is configured
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			cliprint.Info("  API Key:  Configured ✓")
		} else {
			cliprint.Warning("  API Key:  Not configured")
		}

	case "openai":
		cliprint.Info("  Provider: OpenAI (Cloud)")
		cliprint.Info("  Model:    %s", model)
		
		// Check if API key is configured
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			cliprint.Info("  API Key:  Configured ✓")
		} else {
			cliprint.Warning("  API Key:  Not configured")
		}

	default:
		cliprint.Warning("  Provider: Unknown (%s)", provider)
	}
}

// handleLLMList lists available local models
func handleLLMList() {
	// Load config to check provider
	cfg, err := config.Load()
	if err != nil {
		cliprint.Error("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	provider := cfg.Backend.Local.ResolveLLMProvider()

	if provider != "ollama" {
		cliprint.Warning("Local model management is only available for local LLM provider")
		cliprint.Info("Current provider: %s", provider)
		cliprint.Info("")
		cliprint.Info("To use local models, update your configuration:")
		cliprint.Info("  stigmer config set llm.provider ollama")
		return
	}

	// Check if local LLM is running
	if !llm.IsRunning() {
		cliprint.Warning("Local LLM server is not running")
		cliprint.Info("")
		cliprint.Info("Start the server first:")
		cliprint.Info("  stigmer server")
		return
	}

	// List models
	models, err := llm.ListModels(context.Background())
	if err != nil {
		cliprint.Error("Failed to list models")
		clierr.Handle(err)
		return
	}

	if len(models) == 0 {
		cliprint.Info("No models installed")
		cliprint.Info("")
		cliprint.Info("To pull a model:")
		cliprint.Info("  stigmer server llm pull qwen2.5-coder:7b")
		return
	}

	fmt.Println("Available Models:")
	fmt.Println("─────────────────────────────────────")
	for _, model := range models {
		// Highlight current model
		currentModel := cfg.Backend.Local.ResolveLLMModel()
		if model == currentModel {
			cliprint.Success("  %s (current)", model)
		} else {
			cliprint.Info("  %s", model)
		}
	}
	fmt.Println("")
	cliprint.Info("To pull a new model:")
	cliprint.Info("  stigmer server llm pull <model-name>")
}

// handleLLMPull pulls a new model
func handleLLMPull(model string) {
	// Load config to check provider
	cfg, err := config.Load()
	if err != nil {
		cliprint.Error("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	provider := cfg.Backend.Local.ResolveLLMProvider()

	if provider != "ollama" {
		cliprint.Warning("Local model management is only available for local LLM provider")
		cliprint.Info("Current provider: %s", provider)
		return
	}

	// Check if local LLM is running
	if !llm.IsRunning() {
		cliprint.Warning("Local LLM server is not running")
		cliprint.Info("")
		cliprint.Info("Start the server first:")
		cliprint.Info("  stigmer server")
		return
	}

	cliprint.Info("Pulling model %s...", model)
	cliprint.Info("This may take several minutes depending on model size")
	fmt.Println("")

	// Pull model with progress
	progress := cliprint.NewProgressDisplay()
	progress.Start()
	progress.SetPhase(cliprint.PhaseInstalling, fmt.Sprintf("Downloading %s...", model))

	opts := &llm.SetupOptions{
		Progress: progress,
		Model:    model,
	}

	// Empty binaryPath means auto-detect from system PATH or local installation
	if err := llm.PullModel(context.Background(), model, "", opts); err != nil {
		progress.Stop()
		cliprint.Error("Failed to pull model")
		clierr.Handle(err)
		return
	}

	progress.Stop()
	cliprint.Success("Model %s is ready", model)
	fmt.Println("")
	cliprint.Info("To use this model, update your configuration:")
	cliprint.Info("  stigmer config set llm.model %s", model)
}


package root

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/setup"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewServerCommand creates the server command for daemon management
func NewServerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start Stigmer server",
		Long: `Start the Stigmer server in local mode.

This command starts the Stigmer server:
  - Auto-downloads and starts Temporal
  - On first run, prompts to choose an LLM provider (Anthropic, OpenAI, or Ollama)
  - Starts stigmer-server on localhost:7234
  - Starts agent-runner for AI agent execution

Run 'stigmer server setup' to reconfigure the LLM provider at any time.`,
		Run: func(cmd *cobra.Command, args []string) {
			handleServerStart(cmd, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode (default: ghcr.io/stigmer/agent-sandbox-basic:latest)")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newServerSetupCommand())
	cmd.AddCommand(newServerStopCommand())
	cmd.AddCommand(newServerStatusCommand())
	cmd.AddCommand(newServerLogsCommand())
	cmd.AddCommand(newServerLLMCommand())
	cmd.AddCommand(newServerResetCommand())

	return cmd
}

func newServerStopCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "stop",
		Short: "Stop the Stigmer server",
		Run: func(cmd *cobra.Command, args []string) {
			handleServerStop(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newServerStatusCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show server status",
		Run: func(cmd *cobra.Command, args []string) {
			handleServerStatus(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func handleServerStart(cmd *cobra.Command, format clioutput.OutputFormat) {
	if !config.IsInitialized() {
		cfg := config.GetDefault()

		if err := setup.RunWizard(cfg); err != nil {
			climsg.Error("Setup failed: %v", err)
			clierr.Handle(err)
			return
		}

		if err := config.Save(cfg); err != nil {
			climsg.Error("Failed to save configuration")
			clierr.Handle(err)
			return
		}

		configPath, _ := config.GetConfigPath()
		climsg.Success("Configuration saved to %s", configPath)
	}

	dataDir, err := config.GetDataDir()
	if err != nil {
		climsg.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	if daemon.IsRunning(dataDir) {
		climsg.Info("Server is already running, restarting...")
		if err := daemon.Stop(dataDir); err != nil {
			climsg.Warning("Failed to stop existing server: %v", err)
			climsg.Info("Will attempt to start anyway (cleanup will handle orphans)")
		}

		time.Sleep(1 * time.Second)
	}

	climsg.Info("Starting Stigmer server...")

	cfg, err := config.Load()
	if err != nil {
		climsg.Warning("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	llmProvider := cfg.Backend.Local.ResolveLLMProvider()
	llmModel := cfg.Backend.Local.ResolveLLMModel()

	secrets, err := daemon.GatherRequiredSecrets(llmProvider, cfg.Backend.Local)
	if err != nil {
		climsg.Error("Failed to gather required credentials")
		clierr.Handle(err)
		return
	}

	var progress *cliprint.ProgressDisplay
	if format == clioutput.FormatHuman {
		progress = cliprint.NewProgressDisplay()
		progress.Start()
		progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")
	}

	var llmSetupErr error

	executionMode, _ := cmd.Flags().GetString("execution-mode")
	sandboxImage, _ := cmd.Flags().GetString("sandbox-image")
	sandboxAutoPull, _ := cmd.Flags().GetBool("sandbox-auto-pull")
	sandboxCleanup, _ := cmd.Flags().GetBool("sandbox-cleanup")
	sandboxTTL, _ := cmd.Flags().GetInt("sandbox-ttl")

	if err := daemon.StartWithOptions(dataDir, daemon.StartOptions{
		Progress:        progress,
		ExecutionMode:   executionMode,
		SandboxImage:    sandboxImage,
		SandboxAutoPull: sandboxAutoPull,
		SandboxCleanup:  sandboxCleanup,
		SandboxTTL:      sandboxTTL,
		Secrets:         secrets,
		OnLLMSetupFailed: func(err error) {
			llmSetupErr = err
		},
	}); err != nil {
		if progress != nil {
			progress.Stop()
		}
		climsg.Error("Failed to start server")
		clierr.Handle(err)
		return
	}

	// Wait for the gRPC server to accept connections before proceeding.
	// StartWithOptions spawns the server process and returns immediately;
	// the gRPC listener is the last component to start (after SQLite,
	// controllers, Temporal workers, search index, and supervisor), so a
	// successful connection here guarantees full readiness.
	if progress != nil {
		progress.SetPhase(cliprint.PhaseReady, "Waiting for services")
	}

	readyCtx, readyCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer readyCancel()

	endpoint := fmt.Sprintf("localhost:%d", daemon.DaemonPort)
	if err := daemon.WaitForReady(readyCtx, endpoint); err != nil {
		if progress != nil {
			progress.Stop()
		}
		climsg.Error("Server failed to become ready: %v", err)
		clierr.Handle(err)
		return
	}

	if progress != nil {
		progress.CompletePhase(cliprint.PhaseReady)
		progress.Stop()
	}

	// LLM status messaging: only announce after validation is complete.
	displayLLMStatus(llmProvider, llmModel, cfg.Backend.Local, llmSetupErr)

	// Apply seedpack (system agents, skills, MCP servers) before discovery.
	// This ensures system resources exist before we attempt to discover their
	// capabilities. EnsureRunning() also calls this as a safety net, but
	// stigmer server is the canonical place for first-run bootstrap.
	if err := daemon.EnsureSeedpackBootstrapped(dataDir); err != nil {
		climsg.Warning("Failed to apply system resources: %v", err)
	}

	climsg.Info("Discovering MCP server capabilities...")
	runBootstrapDiscovery(cfg)

	running, pid := daemon.GetStatus(dataDir)

	if format == clioutput.FormatHuman {
		climsg.Success("Ready! Stigmer server is running")
		if running {
			climsg.Info("  PID:  %d", pid)
			climsg.Info("  Port: %d", daemon.DaemonPort)
			climsg.Info("  Data: %s", dataDir)
			climsg.Info("")
			climsg.Info("Web UI:")
			climsg.Info("  Temporal:  http://localhost:8233")
		}
		return
	}

	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)
	result := clioutput.Success("Stigmer server is running")
	if running {
		result.AddSection("Server Details").
			Fieldf("PID", "%d", pid).
			Fieldf("Port", "%d", daemon.DaemonPort).
			Field("Data", dataDir)
	}
	result.Hint("Web UI: http://localhost:8233")
	renderer.Render(result)
}

// displayLLMStatus shows the validated LLM provider status after daemon startup.
// This is called AFTER the daemon has started and LLM setup has been attempted,
// ensuring we only announce what actually works (validate-then-announce pattern).
func displayLLMStatus(provider, model string, localCfg *config.LocalBackendConfig, setupErr error) {
	if provider == "" {
		climsg.Warning("No LLM provider configured. Agents will not execute.")
		climsg.Info("Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, then restart.")
		climsg.Info("Or run 'stigmer server setup' to configure interactively.")
		return
	}

	if setupErr != nil {
		climsg.Warning("LLM provider '%s' is not available: %v", provider, setupErr)
		climsg.Warning("Agents will not execute until an LLM provider is available.")

		if alt := config.DetectProviderFromAPIKeys(); alt != "" && alt != provider {
			envVar := "ANTHROPIC_API_KEY"
			if alt == "openai" {
				envVar = "OPENAI_API_KEY"
			}
			climsg.Info("Detected %s in your environment.", envVar)
			climsg.Info("Run 'stigmer server setup' to switch to %s.", alt)
		} else {
			climsg.Info("Run 'stigmer server setup' to configure a different LLM provider.")
		}
		return
	}

	source := localCfg.ResolveLLMProviderSource()
	if source != "" && source != config.ProviderSourceConfigFile {
		climsg.Success("Using %s with model %s (from %s)", provider, model, source)
	} else {
		climsg.Success("Using %s with model %s", provider, model)
	}
}

// runBootstrapDiscovery discovers capabilities for all bootstrapped MCP
// servers. Runs synchronously after daemon start so tool metadata is
// immediately available. Failures are logged but do not block success.
func runBootstrapDiscovery(cfg *config.Config) {
	conn, err := backend.NewConnection()
	if err != nil {
		climsg.Warning("Skipping MCP discovery: %v", err)
		return
	}
	defer conn.Close()

	orgID := "local"
	if cfg.Backend.Type == config.BackendTypeCloud && cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
		orgID = cfg.Backend.Cloud.OrgID
	}

	result := mcpserver.DiscoverAll(context.Background(), &mcpserver.DiscoverAllOptions{
		Conn:    conn,
		Cfg:     cfg,
		OrgID:   orgID,
		Timeout: 30 * time.Second,
	})

	if result.Succeeded > 0 {
		climsg.Success("Discovered capabilities for %d MCP server(s)", result.Succeeded)
	}
	if result.Attempted > result.Succeeded {
		climsg.Warning("Discovery failed for %d MCP server(s)", result.Attempted-result.Succeeded)
	}
	for _, msg := range result.SkipMessages {
		climsg.Warning("%s", msg)
	}
}

func newServerSetupCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "setup",
		Short: "Configure LLM provider",
		Long: `Run the interactive setup wizard to configure your LLM provider.

This re-runs the same wizard shown on first startup. Use it to switch
between Anthropic, OpenAI, Ollama, or to add an API key after skipping
initial setup.

After changing the provider, restart the server to apply:
  stigmer server stop && stigmer server`,
		Run: func(cmd *cobra.Command, args []string) {
			handleServerSetup()
		},
	}
}

func handleServerSetup() {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.GetDefault()
	}

	if err := setup.RunWizardInteractive(cfg); err != nil {
		climsg.Error("Setup failed: %v", err)
		clierr.Handle(err)
		return
	}

	if err := config.Save(cfg); err != nil {
		climsg.Error("Failed to save configuration")
		clierr.Handle(err)
		return
	}

	configPath, _ := config.GetConfigPath()
	climsg.Success("Configuration saved to %s", configPath)

	dataDir, _ := config.GetDataDir()
	if dataDir != "" && daemon.IsRunning(dataDir) {
		fmt.Fprintln(os.Stderr)
		climsg.Info("Server is running. Restart to apply changes:")
		climsg.Info("  stigmer server stop && stigmer server")
	}
}

func handleServerStop(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	dataDir, err := config.GetDataDir()
	if err != nil {
		clierr.Handle(err)
		return
	}

	if !daemon.IsRunning(dataDir) {
		result := clioutput.Warning("Server is not running")
		renderer.Render(result)
		return
	}

	if err := daemon.Stop(dataDir); err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Server stopped successfully")
	renderer.Render(result)
}

package root

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	orgv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/browser"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/setup"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/protobuf/types/known/emptypb"
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
	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
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

	executionMode, _ := cmd.Flags().GetString("execution-mode")
	sandboxImage, _ := cmd.Flags().GetString("sandbox-image")
	sandboxAutoPull, _ := cmd.Flags().GetBool("sandbox-auto-pull")
	sandboxCleanup, _ := cmd.Flags().GetBool("sandbox-cleanup")
	sandboxTTL, _ := cmd.Flags().GetInt("sandbox-ttl")
	noWeb, _ := cmd.Flags().GetBool("no-web")
	openBrowser, _ := cmd.Flags().GetBool("open")

	startServerFresh(dataDir, daemon.StartOptions{
		ExecutionMode:   executionMode,
		SandboxImage:    sandboxImage,
		SandboxAutoPull: sandboxAutoPull,
		SandboxCleanup:  sandboxCleanup,
		SandboxTTL:      sandboxTTL,
		NoWeb:           noWeb,
	}, format, openBrowser)
}

// startServerFresh performs a full interactive server start with phased progress,
// config/secret loading, readiness checks, seedpack bootstrap, org context,
// MCP discovery, and status output. Shared by 'stigmer server' and
// 'stigmer server reset'.
func startServerFresh(dataDir string, startOpts daemon.StartOptions, format clioutput.OutputFormat, openConsole bool) {
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
		progress = cliprint.NewProgressDisplayWithPhases(cliprint.PhaseConfig{
			{Phase: cliprint.PhaseInitializing, Label: "Initializing"},
			{Phase: cliprint.PhaseInstalling, Label: "Installing"},
			{Phase: cliprint.PhaseStarting, Label: "Starting"},
		})
		progress.Start()
	}

	var llmSetupErr error

	startOpts.Progress = progress
	startOpts.Secrets = secrets
	startOpts.OnLLMSetupFailed = func(err error) {
		llmSetupErr = err
	}

	if err := daemon.StartWithOptions(dataDir, startOpts); err != nil {
		if progress != nil {
			progress.Stop()
		}
		climsg.Error("Failed to start server")
		clierr.Handle(err)
		return
	}

	if progress != nil {
		progress.SetPhase(cliprint.PhaseStarting, "Waiting for server to become ready")
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
		progress.CompletePhase(cliprint.PhaseStarting)
		progress.Stop()
	}

	reportDegradedComponents(dataDir)
	displayLLMStatus(llmProvider, llmModel, cfg.Backend.Local, llmSetupErr)

	if err := daemon.EnsureSeedpackBootstrapped(dataDir); err != nil {
		climsg.Warning("Failed to apply system resources: %v", err)
	}

	autoSetOrgContext(cfg)

	climsg.Info("Discovering MCP server capabilities...")
	runBootstrapDiscovery(cfg)

	running, pid := daemon.GetStatus(dataDir)

	webConsoleRunning := false
	if hs := daemon.LoadHealthState(dataDir); hs != nil {
		if cs, ok := hs.Components["web-console"]; ok && cs.State == "running" {
			webConsoleRunning = true
		}
	}

	if format == clioutput.FormatHuman {
		climsg.Success("Ready! Stigmer server is running")
		if running {
			climsg.Info("  PID:  %d", pid)
			climsg.Info("  Port: %d", daemon.DaemonPort)
			climsg.Info("  Data: %s", dataDir)
			climsg.Info("")
			climsg.Info("Web UI:")
			if webConsoleRunning {
				climsg.Info("  Console:   http://localhost:%d", daemon.WebConsolePort)
			}
			climsg.Info("  Temporal:  http://localhost:8233")
		}
	} else {
		renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)
		result := clioutput.Success("Stigmer server is running")
		if running {
			result.AddSection("Server Details").
				Fieldf("PID", "%d", pid).
				Fieldf("Port", "%d", daemon.DaemonPort).
				Field("Data", dataDir)

			webUI := result.AddSection("Web UI")
			if webConsoleRunning {
				webUI.Fieldf("Console", "http://localhost:%d", daemon.WebConsolePort)
			}
			webUI.Field("Temporal", "http://localhost:8233")
		}
		renderer.Render(result)
	}

	if openConsole && webConsoleRunning {
		consoleURL := fmt.Sprintf("http://localhost:%d", daemon.WebConsolePort)
		if err := browser.Open(consoleURL); err != nil {
			climsg.Warning("Could not open browser: %v", err)
		}
	}
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

	orgID := cfg.ResolveContextOrganization()
	if orgID == "" {
		climsg.Warning("Skipping MCP discovery: no organization context set")
		return
	}

	result := mcpserver.ConnectAll(context.Background(), &mcpserver.ConnectAllOptions{
		Conn:    conn,
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

// autoSetOrgContext ensures the CLI has an active organization context. If
// context.organization is already set, this is a no-op. Otherwise, it queries
// the server for available organizations and auto-sets the context when exactly
// one is found. With multiple orgs, it warns the user to choose explicitly.
func autoSetOrgContext(cfg *config.Config) {
	if cfg.ResolveContextOrganization() != "" {
		return
	}

	conn, err := backend.NewConnection()
	if err != nil {
		climsg.Warning("Skipping org context auto-detection: %v", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client := orgv1.NewOrganizationQueryControllerClient(conn)
	resp, err := client.FindMyOrganizations(ctx, &emptypb.Empty{})
	if err != nil {
		climsg.Warning("Failed to detect organizations: %v", err)
		return
	}

	switch len(resp.GetEntries()) {
	case 0:
		climsg.Warning("No organizations found. Resources cannot be applied until an organization exists.")
	case 1:
		org := resp.GetEntries()[0]
		slug := org.GetMetadata().GetSlug()
		cfg.Context.Organization = slug
		if err := config.Save(cfg); err != nil {
			climsg.Warning("Failed to save organization context: %v", err)
			return
		}
		climsg.Success("Active organization: %s", slug)
	default:
		climsg.Warning("Multiple organizations found. Set the active organization:")
		for _, org := range resp.GetEntries() {
			climsg.Info("  - %s", org.GetMetadata().GetSlug())
		}
		climsg.Info("")
		climsg.Info("Run: stigmer config context set --org <slug>")
	}
}

// reportDegradedComponents reads the daemon's health state and warns about
// any components that failed or stopped during startup.
func reportDegradedComponents(dataDir string) {
	hs := daemon.LoadHealthState(dataDir)
	if hs == nil {
		return
	}

	for name, cs := range hs.Components {
		if cs.State != "failed" && cs.State != "stopped" {
			continue
		}
		climsg.Warning("Component %s is %s", name, cs.State)
		if cs.LastError != "" {
			climsg.Warning("  Error: %s", cs.LastError)
		}
		climsg.Info("  View logs: stigmer server logs --component %s", name)
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

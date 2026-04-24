package root

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/browser"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/setup"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// prepareAndStartServer handles first-run initialization, existing-server
// detection, flag extraction, and delegates to startServerFresh. When
// serverOnly is true, only the control plane is started (no runners).
func prepareAndStartServer(cmd *cobra.Command, format clioutput.OutputFormat, serverOnly bool) {
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

	opts := daemon.StartOptions{ServerOnly: serverOnly}

	if !serverOnly {
		opts.ExecutionMode, _ = cmd.Flags().GetString("execution-mode")
		opts.SandboxImage, _ = cmd.Flags().GetString("sandbox-image")
		opts.SandboxAutoPull, _ = cmd.Flags().GetBool("sandbox-auto-pull")
		opts.SandboxCleanup, _ = cmd.Flags().GetBool("sandbox-cleanup")
		opts.SandboxTTL, _ = cmd.Flags().GetInt("sandbox-ttl")
	}

	opts.NoWeb, _ = cmd.Flags().GetBool("no-web")
	openBrowser, _ := cmd.Flags().GetBool("open")

	startServerFresh(dataDir, opts, format, openBrowser)
}

// startServerFresh performs a full interactive server start with phased
// progress, config/secret loading, readiness checks, seedpack bootstrap,
// org context, MCP discovery, and status output. Shared by 'stigmer up'
// and 'stigmer reset'.
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

	printServerStartResult(dataDir, format, openConsole)
}

// printServerStartResult outputs the final status after a successful server
// start. Handles both human and machine-readable formats.
func printServerStartResult(dataDir string, format clioutput.OutputFormat, openConsole bool) {
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

// displayLLMStatus shows the validated LLM provider status after daemon
// startup. Called AFTER the daemon has started and LLM setup has been
// attempted, ensuring we only announce what actually works.
func displayLLMStatus(provider, model string, localCfg *config.LocalBackendConfig, setupErr error) {
	if provider == "" {
		climsg.Warning("No LLM provider configured. Agents will not execute.")
		climsg.Info("Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, then restart.")
		climsg.Info("Or run 'stigmer setup' to configure interactively.")
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
			climsg.Info("Run 'stigmer setup' to switch to %s.", alt)
		} else {
			climsg.Info("Run 'stigmer setup' to configure a different LLM provider.")
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
		climsg.Info("  View logs: stigmer logs --component %s", name)
	}
}

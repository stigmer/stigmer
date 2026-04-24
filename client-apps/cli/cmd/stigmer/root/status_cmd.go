package root

import (
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/bootstrap"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/llm"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewStatusCommand creates the top-level 'stigmer status' command.
func NewStatusCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show service status",
		Long: `Show the status of the Stigmer server and its managed processes.

Displays whether the server is running, its PID, uptime, LLM configuration,
and the status of dependent services.`,
		Example: `  # Show server status
  stigmer status

  # Machine-readable output
  stigmer status --json`,
		Run: func(cmd *cobra.Command, args []string) {
			handleStatus(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func handleStatus(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	dataDir, err := config.GetDataDir()
	if err != nil {
		return
	}

	running, pid := daemon.GetStatus(dataDir)

	if !running {
		result := clioutput.Warning("Stigmer server is not running")
		result.Hint("To start: stigmer up")
		renderer.Render(result)
		return
	}

	hs := daemon.LoadHealthState(dataDir)
	if hs == nil {
		hs = createBasicHealthState(dataDir, pid)
	}

	result := clioutput.Success("Stigmer server is running")

	result.AddSection("Daemon").
		Fieldf("PID", "%d", hs.DaemonPID).
		Fieldf("Port", "%d", daemon.DaemonPort).
		Field("Data", dataDir)

	if !hs.StartedAt.IsZero() {
		result.AddSection("Daemon").
			Field("Uptime", formatDuration(time.Since(hs.StartedAt)))
	}

	componentOrder := []string{"temporal", "stigmer-server", "workflow-runner", "agent-runner", "web-console"}
	componentLabels := map[string]string{
		"temporal":        "Temporal",
		"stigmer-server":  "Stigmer Server",
		"workflow-runner": "Workflow Runner",
		"agent-runner":    "Agent Runner",
		"web-console":     "Web Console",
	}

	for _, name := range componentOrder {
		label := componentLabels[name]
		cs, ok := hs.Components[name]
		if !ok {
			if name == "web-console" {
				continue
			}
			sec := result.AddSection(label)
			sec.Field("Status", "Not Running ○")
			continue
		}

		addComponentSection(result, label, cs)
	}

	addBootstrapSection(result, dataDir)

	cfg, err := config.Load()
	if err == nil {
		addLLMSections(result, cfg)
	}

	temporalRunning := false
	if ts, ok := hs.Components["temporal"]; ok && ts.State == "running" {
		temporalRunning = true
	}
	webConsoleRunning := false
	if cs, ok := hs.Components["web-console"]; ok && cs.State == "running" {
		webConsoleRunning = true
	}

	if webConsoleRunning || temporalRunning {
		webUI := result.AddSection("Web UI")
		if webConsoleRunning {
			webUI.Fieldf("Console", "http://localhost:%d", daemon.WebConsolePort)
		}
		if temporalRunning {
			webUI.Field("Temporal", "http://localhost:8233")
		}
	}

	renderer.Render(result)
}

func addComponentSection(result *clioutput.CommandResult, name string, cs *daemon.ComponentState) {
	sec := result.AddSection(name)

	state := cs.State
	if state == "" {
		state = "unknown"
	}

	symbol := getHealthSymbol(state)
	sec.Fieldf("Status", "%s %s", getStateDisplay(state), symbol)

	if cs.PID > 0 {
		sec.Fieldf("PID", "%d", cs.PID)
	}

	if !cs.StartedAt.IsZero() {
		sec.Field("Uptime", formatDuration(time.Since(cs.StartedAt)))
	}

	if cs.RestartCount > 0 {
		sec.Fieldf("Restarts", "%d", cs.RestartCount)
	} else {
		sec.Field("Restarts", "0")
	}

	if cs.LastError != "" && (state == "failed" || state == "stopped") {
		sec.Field("Last Error", cs.LastError)
	}

	if state == "failed" || state == "stopped" {
		result.Hintf("View %s logs: stigmer logs --component %s", name, name)
	}
}

func addBootstrapSection(result *clioutput.CommandResult, dataDir string) {
	sec := result.AddSection("Bootstrap")

	status := bootstrap.GetBootstrapStatus(dataDir)

	statusDisplay := bootstrap.GetStatusDisplay(status.Status)
	statusSymbol := bootstrap.GetStatusSymbol(status.Status)
	sec.Fieldf("Status", "%s %s", statusDisplay, statusSymbol)

	if status.SeedpackHash != "" {
		sec.Field("Seedpack Hash", status.SeedpackHash)
	}
}

func addLLMSections(result *clioutput.CommandResult, cfg *config.Config) {
	provider := cfg.Backend.Local.ResolveLLMProvider()
	model := cfg.Backend.Local.ResolveLLMModel()

	sec := result.AddSection("LLM Configuration")

	switch provider {
	case "ollama":
		running, pid, models, err := llm.GetStatus()
		if err != nil {
			sec.Fieldf("Provider", "Local (Error: %v)", err)
			return
		}

		if running {
			sec.Field("Provider", "Local ✓ Running")
			if pid > 0 {
				sec.Fieldf("PID", "%d", pid)
			}
			sec.Field("Model", model)
			if len(models) > 0 {
				sec.Field("Available", strings.Join(models, ", "))
			}
		} else {
			sec.Field("Provider", "Local ✗ Not Running")
			sec.Fieldf("Model", "%s (will be downloaded on first use)", model)
		}

	case "anthropic":
		sec.Field("Provider", "Anthropic (Cloud)")
		sec.Field("Model", model)
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			sec.Field("API Key", "Configured ✓")
		} else {
			sec.Field("API Key", "Not configured ✗")
		}

	case "openai":
		sec.Field("Provider", "OpenAI (Cloud)")
		sec.Field("Model", model)
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			sec.Field("API Key", "Configured ✓")
		} else {
			sec.Field("API Key", "Not configured ✗")
		}

	case "":
		sec.Field("Provider", "Not configured")
		sec.Field("Status", "Agents will not execute")
		sec.Field("Setup", "Run 'stigmer setup' to configure")

	default:
		sec.Fieldf("Provider", "Unknown (%s)", provider)
	}
}

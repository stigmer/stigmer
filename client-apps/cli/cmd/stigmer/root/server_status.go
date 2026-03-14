package root

import (
	"os"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/bootstrap"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

func handleServerStatus(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	dataDir, err := config.GetDataDir()
	if err != nil {
		return
	}

	running, pid := daemon.GetStatus(dataDir)

	if !running {
		result := clioutput.Warning("Stigmer server is not running")
		result.Hint("To start: stigmer server")
		renderer.Render(result)
		return
	}

	// Read the daemon's health state file (written atomically by the daemon process)
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
			// Web console is optional (depends on build tag and --no-web).
			// Only show it when it has a health state entry.
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

// addComponentSection appends a section for a managed component.
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
		result.Hintf("View %s logs: stigmer server logs --component %s",
			name, componentNameToFlag(name))
	}
}

func componentNameToFlag(name string) string {
	return name
}

// addBootstrapSection appends the bootstrap/seedpack status.
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

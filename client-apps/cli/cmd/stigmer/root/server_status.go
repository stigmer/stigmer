package root

import (
	"fmt"
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

	healthSummary := daemon.GetHealthSummary()
	if len(healthSummary) == 0 {
		healthSummary = createBasicHealthStatus(dataDir, pid)
	}

	result := clioutput.Success("Stigmer server is running")

	addComponentSection(result, "Stigmer Server", healthSummary["stigmer-server"], pid)

	if wfPID, err := daemon.GetWorkflowRunnerPID(dataDir); err == nil {
		addComponentSection(result, "Workflow Runner", healthSummary["workflow-runner"], wfPID)
	}

	agentStatus := daemon.GetAgentRunnerStatus(dataDir)
	addAgentRunnerSection(result, healthSummary["agent-runner"], agentStatus)

	result.AddSection("Server Details").
		Fieldf("Port", "%d", daemon.DaemonPort).
		Field("Data", dataDir)

	addBootstrapSection(result)

	cfg, err := config.Load()
	if err == nil {
		addLLMSections(result, cfg)
	}

	result.AddSection("Web UI").
		Field("Temporal", "http://localhost:8233")

	if len(healthSummary) > 0 {
		result.Hint("Health Monitoring: Active ✓")
	}

	renderer.Render(result)
}

// addComponentSection appends a section for a process-based component
// (Stigmer Server, Workflow Runner) with its health status and details.
func addComponentSection(result *clioutput.CommandResult, name string, health daemon.ComponentHealth, pid int) {
	sec := result.AddSection(name)

	healthSymbol := getHealthSymbol(health.State)
	sec.Fieldf("Status", "%s %s", getStateDisplay(health.State), healthSymbol)
	sec.Fieldf("PID", "%d", pid)

	if !health.StartTime.IsZero() {
		sec.Field("Uptime", formatDuration(time.Since(health.StartTime)))
	}

	if health.RestartCount > 0 {
		sec.Fieldf("Restarts", "%d", health.RestartCount)
		if !health.LastRestart.IsZero() {
			sec.Fieldf("Last Restart", "%s ago", formatDuration(time.Since(health.LastRestart)))
		}
	} else {
		sec.Field("Restarts", "0")
	}

	if health.State == "unhealthy" && health.LastError != nil {
		sec.Fieldf("Last Error", "%v", health.LastError)
	}
}

// addAgentRunnerSection appends a section for the Docker-based agent-runner
// with enhanced status, crash loop detection, and actionable hints.
func addAgentRunnerSection(result *clioutput.CommandResult, health daemon.ComponentHealth, agentStatus *daemon.AgentRunnerStatus) {
	sec := result.AddSection("Agent Runner (Docker)")

	if !agentStatus.Found {
		sec.Field("Status", "Not Running ○")
		sec.Field("Container", "not found")
		result.Hint("Agent-runner container is not running. Try: stigmer server")
		return
	}

	displayState, displaySymbol := resolveAgentRunnerDisplay(health, agentStatus)

	statusValue := fmt.Sprintf("%s %s", getStateDisplay(displayState), displaySymbol)
	if agentStatus.InCrashLoop {
		statusValue = fmt.Sprintf("%s (crash loop) %s", getStateDisplay(displayState), displaySymbol)
	} else if agentStatus.Restarting {
		statusValue = fmt.Sprintf("%s (restarting) %s", getStateDisplay(displayState), displaySymbol)
	}
	sec.Field("Status", statusValue)

	containerID := agentStatus.ContainerID
	if len(containerID) > 12 {
		sec.Field("Container", containerID[:12])
	} else if containerID != "" {
		sec.Field("Container", containerID)
	}

	if !health.StartTime.IsZero() {
		sec.Field("Uptime", formatDuration(time.Since(health.StartTime)))
	}

	restartCount := agentStatus.RestartCount
	if health.RestartCount > 0 && health.RestartCount > restartCount {
		restartCount = health.RestartCount
	}

	if restartCount > 0 {
		if agentStatus.InCrashLoop {
			sec.Fieldf("Restarts", "%d (crash loop detected)", restartCount)
		} else {
			sec.Fieldf("Restarts", "%d", restartCount)
		}
	} else {
		sec.Field("Restarts", "0")
	}

	if !agentStatus.Running && agentStatus.ExitCode != 0 {
		sec.Fieldf("Exit Code", "%d", agentStatus.ExitCode)
	}

	lastError := agentStatus.LastError
	if lastError == "" && health.LastError != nil {
		lastError = health.LastError.Error()
	}
	if lastError != "" && (displayState == "unhealthy" || displayState == "stopped" || !agentStatus.Running) {
		sec.Field("Last Error", lastError)
	}

	if displayState == "unhealthy" || displayState == "stopped" || agentStatus.InCrashLoop || !agentStatus.Running {
		result.Hint("View agent-runner logs: stigmer server logs --component agent-runner")
		result.Hintf("  or: docker logs %s", daemon.AgentRunnerContainerName)
	}
}

func resolveAgentRunnerDisplay(health daemon.ComponentHealth, agentStatus *daemon.AgentRunnerStatus) (daemon.ComponentState, string) {
	var displayState daemon.ComponentState
	var displaySymbol string

	if agentStatus.InCrashLoop || agentStatus.Restarting {
		displayState = "unhealthy"
		displaySymbol = "✗"
	} else if agentStatus.Running {
		displayState = "running"
		displaySymbol = "✓"
	} else {
		displayState = "stopped"
		displaySymbol = "○"
	}

	if health.State != "" {
		displayState = health.State
		displaySymbol = getHealthSymbol(health.State)
	}

	return displayState, displaySymbol
}

// addBootstrapSection appends the bootstrap/seedpack status to an existing result.
func addBootstrapSection(result *clioutput.CommandResult) {
	sec := result.AddSection("Bootstrap")

	status, err := bootstrap.GetBootstrapStatus()
	if err != nil {
		sec.Fieldf("Status", "Unable to read (%v)", err)
		return
	}

	statusDisplay := bootstrap.GetStatusDisplay(status.Status)
	statusSymbol := bootstrap.GetStatusSymbol(status.Status)
	sec.Fieldf("Status", "%s %s", statusDisplay, statusSymbol)

	if status.Version != "" {
		sec.Field("Version", status.Version)
	}

	skillNames := bootstrap.FormatResourceNames(status.Skills)
	sec.Fieldf("Skills", "%d applied (%s)", len(status.Skills), skillNames)

	agentNames := bootstrap.FormatResourceNames(status.Agents)
	sec.Fieldf("Agents", "%d applied (%s)", len(status.Agents), agentNames)
}

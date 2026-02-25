package root

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

func isProcessAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	err = process.Signal(syscall.Signal(0))
	return err == nil
}

func isDockerContainerRunning(containerID string) bool {
	cmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", containerID)
	output, err := cmd.Output()
	if err != nil {
		return false
	}

	return strings.TrimSpace(string(output)) == "true"
}

// createBasicHealthStatus creates a basic health status map when the health
// monitor isn't accessible (status command runs in a separate process from the daemon).
func createBasicHealthStatus(dataDir string, stigmerPID int) map[string]daemon.ComponentHealth {
	healthMap := make(map[string]daemon.ComponentHealth)

	healthMap["stigmer-server"] = daemon.ComponentHealth{
		State: daemon.ComponentState("running"),
	}

	if wfPID, err := daemon.GetWorkflowRunnerPID(dataDir); err == nil {
		if isProcessAlive(wfPID) {
			healthMap["workflow-runner"] = daemon.ComponentHealth{
				State: daemon.ComponentState("running"),
			}
		} else {
			healthMap["workflow-runner"] = daemon.ComponentHealth{
				State: daemon.ComponentState("unhealthy"),
			}
		}
	}

	agentStatus := daemon.GetAgentRunnerStatus(dataDir)
	if agentStatus.Found {
		health := daemon.ComponentHealth{}

		if agentStatus.Restarting || agentStatus.InCrashLoop {
			health.State = daemon.ComponentState("unhealthy")
			if agentStatus.LastError != "" {
				health.LastError = fmt.Errorf("%s", agentStatus.LastError)
			} else {
				health.LastError = fmt.Errorf("container in crash loop (%d restarts)", agentStatus.RestartCount)
			}
		} else if agentStatus.Running {
			health.State = daemon.ComponentState("running")
		} else {
			health.State = daemon.ComponentState("stopped")
			if agentStatus.ExitCode != 0 {
				health.LastError = fmt.Errorf("exited with code %d", agentStatus.ExitCode)
			}
		}

		health.RestartCount = agentStatus.RestartCount
		healthMap["agent-runner"] = health
	} else {
		healthMap["agent-runner"] = daemon.ComponentHealth{
			State: daemon.ComponentState("stopped"),
		}
	}

	return healthMap
}

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

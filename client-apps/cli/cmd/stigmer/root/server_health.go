package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
	return process.Signal(syscall.Signal(0)) == nil
}

func readPIDFile(dataDir, filename string) int {
	data, err := os.ReadFile(filepath.Join(dataDir, filename))
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0
	}
	return pid
}

func getStateDisplay(state string) string {
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
		return state
	}
}

func getHealthSymbol(state string) string {
	switch state {
	case "running":
		return "✓"
	case "starting":
		return "↻"
	case "unhealthy", "failed":
		return "✗"
	case "restarting":
		return "↻"
	case "stopped":
		return "○"
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
	}
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	return fmt.Sprintf("%dd %dh", days, hours)
}

// createBasicHealthState creates a fallback HealthState by reading PID files
// directly when health-state.json is not available.
func createBasicHealthState(dataDir string, daemonPID int) *daemon.HealthState {
	hs := &daemon.HealthState{
		DaemonPID:  daemonPID,
		Components: make(map[string]*daemon.ComponentState),
	}

	hs.Components["stigmer-server"] = &daemon.ComponentState{
		State: "running",
	}

	if wfPID, err := daemon.GetWorkflowRunnerPID(dataDir); err == nil {
		state := "running"
		if !isProcessAlive(wfPID) {
			state = "stopped"
		}
		hs.Components["workflow-runner"] = &daemon.ComponentState{
			PID:   wfPID,
			State: state,
		}
	} else {
		hs.Components["workflow-runner"] = &daemon.ComponentState{State: "stopped"}
	}

	arPID := readPIDFile(dataDir, daemon.AgentRunnerPIDFileName)
	if arPID > 0 {
		state := "running"
		if !isProcessAlive(arPID) {
			state = "stopped"
		}
		hs.Components["agent-runner"] = &daemon.ComponentState{
			PID:   arPID,
			State: state,
		}
	} else {
		hs.Components["agent-runner"] = &daemon.ComponentState{State: "stopped"}
	}

	return hs
}

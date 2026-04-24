package root

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
)

func isProcessAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

func readPIDFile(dir, filename string) int {
	data, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		return 0
	}
	line := strings.TrimSpace(string(data))
	if idx := strings.IndexByte(line, '\n'); idx > 0 {
		line = line[:idx]
	}
	pid, err := strconv.Atoi(strings.TrimSpace(line))
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

// createBasicHealthState creates a fallback HealthState by probing PID files
// and TCP ports when health-state.json is not available.
func createBasicHealthState(dataDir string, daemonPID int) *daemon.HealthState {
	hs := &daemon.HealthState{
		DaemonPID:  daemonPID,
		Components: make(map[string]*daemon.ComponentState),
	}

	temporalAddr := fmt.Sprintf("localhost:%d", temporal.DefaultTemporalPort)
	conn, err := net.DialTimeout("tcp", temporalAddr, 200*time.Millisecond)
	if err != nil {
		hs.Components["temporal"] = &daemon.ComponentState{State: "stopped"}
	} else {
		conn.Close()
		temporalPID := readPIDFile(filepath.Dir(dataDir), temporal.TemporalPIDFileName)
		hs.Components["temporal"] = &daemon.ComponentState{
			PID:   temporalPID,
			State: "running",
		}
	}

	serverAddr := fmt.Sprintf("localhost:%d", daemon.DaemonPort)
	serverConn, serverErr := net.DialTimeout("tcp", serverAddr, 200*time.Millisecond)
	if serverErr != nil {
		hs.Components["stigmer-server"] = &daemon.ComponentState{State: "unhealthy"}
	} else {
		serverConn.Close()
		hs.Components["stigmer-server"] = &daemon.ComponentState{State: "running"}
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

	arPID := readPIDFile(dataDir, daemon.RunnerPIDFileName)
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

	webConsoleAddr := fmt.Sprintf("localhost:%d", daemon.WebConsolePort)
	wcConn, wcErr := net.DialTimeout("tcp", webConsoleAddr, 200*time.Millisecond)
	if wcErr == nil {
		wcConn.Close()
		hs.Components["web-console"] = &daemon.ComponentState{State: "running"}
	}

	return hs
}

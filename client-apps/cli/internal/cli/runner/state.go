package runner

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/runner/controlsock"
)

const runnersDirName = "runners"

const (
	RuntimeNative = "native"
	RuntimeDocker = "docker"
)

// RunnerState is the on-disk representation of a running runner.
// Persisted at ~/.stigmer/runners/<name>.json so that `stigmer down runner`
// can find and stop it.
//
// The daemon writes state files for the embedded runner with
// ManagedByDaemon=true. These runners are stopped via `stigmer down`
// (daemon shutdown), not via `stigmer down runner`.
type RunnerState struct {
	RunnerID        string    `json:"runner_id"`
	Slug            string    `json:"slug"`
	Org             string    `json:"org"`
	BackendEndpoint string    `json:"backend_endpoint"`
	PID             int       `json:"pid"`
	TaskQueue       string    `json:"task_queue"`
	StartedAt       time.Time `json:"started_at"`
	ManagedByDaemon bool      `json:"managed_by_daemon,omitempty"`

	// Runtime indicates how the agent-runner process was started.
	// Empty or "native" means a local Python process (PID-tracked).
	// "docker" means a Docker container (ContainerID-tracked).
	Runtime     string `json:"runtime,omitempty"`
	ContainerID string `json:"container_id,omitempty"`

	// CursorRunnerPID is the PID of the cursor-runner TypeScript process
	// when it runs alongside the agent-runner. Zero when the Cursor harness
	// is not active.
	CursorRunnerPID int `json:"cursor_runner_pid,omitempty"`

	// LogFile is the absolute path to the runner's log file. The CLI
	// tees stdout+stderr to this file so that external consumers (e.g.
	// the desktop app) can tail logs for any local runner, not just
	// runners managed as child processes.
	LogFile string `json:"log_file,omitempty"`

	// MachineID is the stable machine identifier from ~/.stigmer/machine.json.
	// Used for runner adoption across hostname changes. Empty in pre-T03
	// state files; backfilled on first load after upgrade.
	MachineID string `json:"machine_id,omitempty"`

	// SocketPath is the absolute path to the runner's local control socket
	// (Unix domain socket). Other processes use this to query runner status
	// and request graceful shutdown without PID-based probing.
	// Empty in pre-T04 state files.
	SocketPath string `json:"socket_path,omitempty"`
}

// IsDocker returns true if this runner is managed as a Docker container.
func (s *RunnerState) IsDocker() bool {
	return s.Runtime == RuntimeDocker
}

// RunnersDir returns the path to ~/.stigmer/runners/, creating it if needed.
func RunnersDir() (string, error) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to resolve config directory")
	}
	dir := filepath.Join(configDir, runnersDirName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", errors.Wrap(err, "failed to create runners directory")
	}
	return dir, nil
}

const runDirName = "run"

// RunDir returns the path to ~/.stigmer/run/, creating it if needed.
// This directory holds ephemeral runtime artifacts (Unix sockets) that
// are separate from the persistent state files in ~/.stigmer/runners/.
func RunDir() (string, error) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to resolve config directory")
	}
	dir := filepath.Join(configDir, runDirName)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", errors.Wrap(err, "failed to create run directory")
	}
	return dir, nil
}

// DefaultSocketPath returns ~/.stigmer/run/runner.sock. This short,
// flat path stays well within macOS's 104-byte sun_path limit.
func DefaultSocketPath() (string, error) {
	dir, err := RunDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "runner.sock"), nil
}

// LogFilePath returns the path to ~/.stigmer/runners/<name>.log.
func LogFilePath(name string) (string, error) {
	dir, err := RunnersDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name+".log"), nil
}

// SaveState writes runner state to ~/.stigmer/runners/<name>.json.
func SaveState(name string, state *RunnerState) error {
	dir, err := RunnersDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal runner state")
	}
	path := filepath.Join(dir, name+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		return errors.Wrapf(err, "failed to write runner state to %s", path)
	}
	return nil
}

// LoadState reads runner state from ~/.stigmer/runners/<name>.json.
func LoadState(name string) (*RunnerState, error) {
	dir, err := RunnersDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, name+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read runner state from %s", path)
	}
	var state RunnerState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal runner state")
	}
	return &state, nil
}

// RemoveState deletes the state file for a named runner and cleans up
// any associated control socket. The log file is intentionally preserved
// so that crash diagnostics remain available to the user and the desktop
// app's log viewer after the runner exits. The log file is truncated on
// the next start by openRunnerLogFile, so stale logs do not accumulate.
func RemoveState(name string) error {
	dir, err := RunnersDir()
	if err != nil {
		return err
	}

	// Try to read the state first to find the socket path.
	state, _ := LoadState(name)
	if state != nil && state.SocketPath != "" {
		_ = os.Remove(state.SocketPath)
	}

	path := filepath.Join(dir, name+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return errors.Wrapf(err, "failed to remove runner state at %s", path)
	}
	return nil
}

// IsActive checks whether a runner with the given name is still alive.
// For native runners, it probes the recorded PID. For Docker runners,
// it checks whether the container is still running.
func IsActive(name string) bool {
	state, err := LoadState(name)
	if err != nil {
		return false
	}
	return isRunnerAlive(state)
}

// ListActiveRunners returns the names of all runners that have state files
// and are still alive. Stale state files are removed as a side effect.
func ListActiveRunners() ([]string, error) {
	states, err := loadAllStates()
	if err != nil {
		return nil, err
	}
	var active []string
	for name, state := range states {
		if isRunnerAlive(state) {
			active = append(active, name)
		} else {
			_ = RemoveState(name)
		}
	}
	return active, nil
}

// ListAllRunnerStates returns name-keyed state for every active runner.
// Stale state files are removed as a side effect.
func ListAllRunnerStates() (map[string]*RunnerState, error) {
	states, err := loadAllStates()
	if err != nil {
		return nil, err
	}
	active := make(map[string]*RunnerState, len(states))
	for name, state := range states {
		if isRunnerAlive(state) {
			active[name] = state
		} else {
			_ = RemoveState(name)
		}
	}
	return active, nil
}

// ReapStaleRunners removes state files for runners that are no longer alive.
// Returns the names of reaped runners for caller logging.
func ReapStaleRunners() []string {
	states, err := loadAllStates()
	if err != nil {
		return nil
	}
	var reaped []string
	for name, state := range states {
		if !isRunnerAlive(state) {
			if err := RemoveState(name); err == nil {
				reaped = append(reaped, name)
			}
		}
	}
	return reaped
}

// loadAllStates reads every .json file in the runners directory and returns
// name-keyed state. Files that fail to parse are silently skipped.
func loadAllStates() (map[string]*RunnerState, error) {
	dir, err := RunnersDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list runners directory")
	}
	states := make(map[string]*RunnerState, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		state, err := LoadState(name)
		if err != nil {
			continue
		}
		states[name] = state
	}
	return states, nil
}

// findStateByMachineID scans all runner state files for one matching the
// given machine ID. Returns the state file name and state, or ("", nil) if
// no match is found. Dead runners are cleaned up as a side effect.
func findStateByMachineID(machineID string) (string, *RunnerState) {
	if machineID == "" {
		return "", nil
	}
	states, err := loadAllStates()
	if err != nil {
		return "", nil
	}
	for name, state := range states {
		if !isRunnerAlive(state) {
			_ = RemoveState(name)
			continue
		}
		if state.MachineID == machineID {
			return name, state
		}
	}
	return "", nil
}

// MigrateStateLayout renames state files from the legacy hostname-slug
// naming (<slug>.json) to machine_id-keyed naming (<machine_id>.json).
// This aligns the file layout with the stable identity model introduced
// in T03.
//
// The migration is idempotent: files whose name already matches their
// MachineID are skipped. Files without a MachineID are left as-is
// (they will be backfilled when the runner next starts via Ensure).
//
// Returns the names of migrated files for caller logging.
func MigrateStateLayout() []string {
	states, err := loadAllStates()
	if err != nil {
		return nil
	}

	var migrated []string
	for name, state := range states {
		if state.MachineID == "" {
			continue
		}
		if name == state.MachineID {
			continue
		}

		dir, err := RunnersDir()
		if err != nil {
			continue
		}

		oldPath := filepath.Join(dir, name+".json")
		newPath := filepath.Join(dir, state.MachineID+".json")

		// Don't overwrite an existing file at the destination.
		if _, err := os.Stat(newPath); err == nil {
			continue
		}

		data, err := os.ReadFile(oldPath)
		if err != nil {
			continue
		}

		if err := os.WriteFile(newPath, data, 0600); err != nil {
			continue
		}

		if err := os.Remove(oldPath); err != nil {
			// Wrote new but couldn't remove old — remove the new to
			// avoid duplicates. Next run will retry.
			_ = os.Remove(newPath)
			continue
		}

		// Also migrate the log file if it exists.
		oldLog := filepath.Join(dir, name+".log")
		newLog := filepath.Join(dir, state.MachineID+".log")
		if _, err := os.Stat(oldLog); err == nil {
			_ = os.Rename(oldLog, newLog)
		}

		migrated = append(migrated, name+" -> "+state.MachineID)
	}

	return migrated
}

// isRunnerAlive checks whether a runner is still alive based on its runtime.
// For native runners with a control socket, a socket health check is
// preferred over PID probing because it proves the process is actually a
// Stigmer runner (not PID reuse) and is responsive. The PID probe remains
// as a fallback for pre-T04 runners without a socket path.
//
// When the socket is unreachable and the PID is alive, an additional
// orphan check determines whether the process's parent has died (PPID == 1).
// Orphaned runners are non-functional (no heartbeat stream, no control
// socket) and are killed so the next Ensure can start a fresh runner.
func isRunnerAlive(state *RunnerState) bool {
	if state.IsDocker() {
		return IsContainerAlive(NewDockerClient(), state.ContainerID)
	}

	if state.SocketPath != "" {
		if controlsock.IsHealthy(state.SocketPath) {
			return true
		}
		if isProcessAlive(state.PID) {
			if isOrphaned(state.PID) {
				log.Info().
					Int("pid", state.PID).
					Msg("Runner process is orphaned (parent died) — treating as dead and killing")
				killOrphanedRunner(state)
				return false
			}
			log.Debug().
				Int("pid", state.PID).
				Str("socket", state.SocketPath).
				Msg("Control socket unreachable but PID is alive (startup race or stale socket path)")
			return true
		}
		return false
	}

	return isProcessAlive(state.PID)
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// isOrphaned reports whether a process has been reparented to PID 1
// (init/launchd), indicating its original parent died. Uses ps(1) for
// portability across macOS and Linux.
func isOrphaned(pid int) bool {
	if pid <= 0 {
		return false
	}
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "ppid=").Output()
	if err != nil {
		return false
	}
	ppid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return false
	}
	return ppid == 1
}

// killOrphanedRunner sends SIGTERM (then SIGKILL after a brief wait) to
// the agent-runner PID and, if recorded, the cursor-runner sidecar PID.
// Called when isRunnerAlive detects an orphaned runner that will never
// recover on its own (no parent to manage its lifecycle).
func killOrphanedRunner(state *RunnerState) {
	killProcess(state.PID, "agent-runner")
	if state.CursorRunnerPID > 0 {
		killProcess(state.CursorRunnerPID, "cursor-runner")
	}
}

const orphanKillGrace = 3 * time.Second

func killProcess(pid int, label string) {
	if !isProcessAlive(pid) {
		return
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	log.Info().Int("pid", pid).Str("component", label).Msg("Sending SIGTERM to orphaned process")
	_ = proc.Signal(syscall.SIGTERM)

	deadline := time.Now().Add(orphanKillGrace)
	for time.Now().Before(deadline) {
		if !isProcessAlive(pid) {
			log.Info().Int("pid", pid).Str("component", label).Msg("Orphaned process exited after SIGTERM")
			return
		}
		time.Sleep(200 * time.Millisecond)
	}

	log.Warn().Int("pid", pid).Str("component", label).Msg("Orphaned process did not exit in time, sending SIGKILL")
	_ = proc.Kill()
}

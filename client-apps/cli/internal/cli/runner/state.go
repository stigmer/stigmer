package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
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

// RemoveState deletes the state file for a named runner. The log file is
// intentionally preserved so that crash diagnostics remain available to
// the user and the desktop app's log viewer after the runner exits. The
// log file is truncated on the next start by openRunnerLogFile, so stale
// logs do not accumulate.
func RemoveState(name string) error {
	dir, err := RunnersDir()
	if err != nil {
		return err
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

// isRunnerAlive checks whether a runner is still alive based on its runtime.
// Native runners are checked via PID probe; Docker runners via container state.
func isRunnerAlive(state *RunnerState) bool {
	if state.IsDocker() {
		return IsContainerAlive(NewDockerClient(), state.ContainerID)
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

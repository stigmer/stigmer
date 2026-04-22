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

// RunnerState is the on-disk representation of a running standalone runner.
// Persisted at ~/.stigmer/runners/<name>.json so that `stigmer down runner`
// can find and stop it.
type RunnerState struct {
	RunnerID        string    `json:"runner_id"`
	Slug            string    `json:"slug"`
	Org             string    `json:"org"`
	BackendEndpoint string    `json:"backend_endpoint"`
	PID             int       `json:"pid"`
	TaskQueue       string    `json:"task_queue"`
	StartedAt       time.Time `json:"started_at"`
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

// RemoveState deletes the state file for a named runner.
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

// IsActive checks whether a runner with the given name is still alive by
// reading its state file and probing the recorded PID.
func IsActive(name string) bool {
	state, err := LoadState(name)
	if err != nil {
		return false
	}
	return isProcessAlive(state.PID)
}

// ListActiveRunners returns the names of all runners that have state files
// and whose PIDs are still alive.
func ListActiveRunners() ([]string, error) {
	dir, err := RunnersDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list runners directory")
	}
	var active []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		if IsActive(name) {
			active = append(active, name)
		}
	}
	return active, nil
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

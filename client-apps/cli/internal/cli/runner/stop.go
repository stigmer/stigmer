package runner

import (
	"os"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const stopTimeout = 5 * time.Second

// StopRunner stops a single named runner by sending SIGTERM to its recorded
// PID. The running process handles SIGTERM by sending a STOPPED heartbeat
// over the bidi command stream and then exiting.
//
// Daemon-managed runners (ManagedByDaemon=true) cannot be stopped
// independently — they are stopped when the daemon shuts down.
func StopRunner(name string) error {
	state, err := LoadState(name)
	if err != nil {
		return errors.Wrapf(err, "no state found for runner %q", name)
	}

	if state.ManagedByDaemon {
		climsg.Info("Runner %q is managed by the daemon. Use 'stigmer down' to stop it.", name)
		return nil
	}

	if !isProcessAlive(state.PID) {
		climsg.Warning("Runner %q (PID %d) is not running, cleaning up state", name, state.PID)
		return RemoveState(name)
	}

	climsg.Info("Stopping runner %q (PID %d) ...", name, state.PID)

	proc, err := os.FindProcess(state.PID)
	if err != nil {
		return errors.Wrapf(err, "failed to find process %d for runner %q", state.PID, name)
	}

	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return errors.Wrapf(err, "failed to send SIGTERM to runner %q (PID %d)", name, state.PID)
	}

	if !waitForExit(state.PID, stopTimeout) {
		log.Warn().Int("pid", state.PID).Msg("Runner did not exit in time, sending SIGKILL")
		_ = proc.Kill()
	}

	if err := RemoveState(name); err != nil {
		return errors.Wrapf(err, "failed to clean up state for runner %q", name)
	}

	climsg.Success("Runner %q stopped", name)
	return nil
}

// StopAllRunners stops every standalone runner that has a state file and a
// live PID. Daemon-managed runners are skipped — they are stopped when the
// daemon shuts down via `stigmer down`.
func StopAllRunners() error {
	states, err := ListAllRunnerStates()
	if err != nil {
		return errors.Wrap(err, "failed to list active runners")
	}

	var names []string
	for name, state := range states {
		if !state.ManagedByDaemon {
			names = append(names, name)
		}
	}

	if len(names) == 0 {
		climsg.Info("No active standalone runners found")
		return nil
	}

	var firstErr error
	for _, name := range names {
		if err := StopRunner(name); err != nil {
			climsg.Warning("Failed to stop runner %q: %v", name, err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func waitForExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !isProcessAlive(pid) {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

package runner

import (
	"context"
	"os"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/runner/controlsock"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const stopTimeout = 5 * time.Second

// StopRunner stops a single named runner. For native runners, it sends
// SIGTERM to the recorded PID. For Docker runners, it stops and removes
// the container. Daemon-managed runners cannot be stopped independently.
func StopRunner(name string) error {
	state, err := LoadState(name)
	if err != nil {
		return errors.Wrapf(err, "no state found for runner %q", name)
	}

	if state.ManagedByDaemon {
		climsg.Info("Runner %q is managed by the daemon. Use 'stigmer down' to stop it.", name)
		return nil
	}

	if state.IsDocker() {
		return stopDockerRunner(name, state)
	}
	return stopNativeRunner(name, state)
}

func stopNativeRunner(name string, state *RunnerState) error {
	if !isProcessAlive(state.PID) {
		climsg.Warning("Runner %q (PID %d) is not running, cleaning up state", name, state.PID)
		return RemoveState(name)
	}

	climsg.Info("Stopping runner %q (PID %d) ...", name, state.PID)

	// Prefer the control socket for graceful shutdown — it lets the runner
	// acknowledge the stop request and clean up its own resources before
	// exiting. Falls back to SIGTERM for pre-T04 runners without a socket.
	socketStopSent := false
	if state.SocketPath != "" {
		if err := controlsock.Stop(state.SocketPath); err != nil {
			log.Debug().Err(err).Str("socket", state.SocketPath).
				Msg("Control socket stop failed, falling back to SIGTERM")
		} else {
			socketStopSent = true
		}
	}

	if !socketStopSent {
		proc, err := os.FindProcess(state.PID)
		if err != nil {
			return errors.Wrapf(err, "failed to find process %d for runner %q", state.PID, name)
		}
		if err := proc.Signal(syscall.SIGTERM); err != nil {
			return errors.Wrapf(err, "failed to send SIGTERM to runner %q (PID %d)", name, state.PID)
		}
	}

	if !waitForExit(state.PID, stopTimeout) {
		log.Warn().Int("pid", state.PID).Msg("Runner did not exit in time, sending SIGKILL")
		proc, _ := os.FindProcess(state.PID)
		if proc != nil {
			_ = proc.Kill()
		}
	}

	if err := RemoveState(name); err != nil {
		return errors.Wrapf(err, "failed to clean up state for runner %q", name)
	}

	climsg.Success("Runner %q stopped", name)
	return nil
}

func stopDockerRunner(name string, state *RunnerState) error {
	dc := NewDockerClient()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if !IsContainerAlive(dc, state.ContainerID) {
		climsg.Warning("Runner %q (container %s) is not running, cleaning up state",
			name, truncateID(state.ContainerID))
		_ = dc.Remove(ctx, state.ContainerID)
		return RemoveState(name)
	}

	climsg.Info("Stopping runner %q (container %s) ...", name, truncateID(state.ContainerID))

	if err := dc.Stop(ctx, state.ContainerID); err != nil {
		log.Warn().Err(err).Msg("Failed to stop container gracefully")
	}

	if err := dc.Remove(ctx, state.ContainerID); err != nil {
		log.Warn().Err(err).Msg("Failed to remove container")
	}

	if err := RemoveState(name); err != nil {
		return errors.Wrapf(err, "failed to clean up state for runner %q", name)
	}

	climsg.Success("Runner %q stopped", name)
	return nil
}

func truncateID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
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

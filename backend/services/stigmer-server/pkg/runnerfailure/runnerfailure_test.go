package runnerfailure

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.temporal.io/sdk/temporal"
)

// canceledWithMessage mirrors how the SDK's failure converter materializes a
// TS CancelledFailure in Go: NewCanceledErrorWithOptions with the failure
// proto's message (the bare NewCanceledError constructor carries details only).
func canceledWithMessage(msg string) error {
	return temporal.NewCanceledErrorWithOptions(temporal.CanceledErrorOptions{Message: msg})
}

// The runner's own shutdown classification (execute-cursor / execute-deep-agent
// throw this exact message) must be recognized however it crosses the boundary.
func TestIsWorkerShutdown_RunnerClassifiedCanceledFailure(t *testing.T) {
	err := canceledWithMessage("Activity cancelled (worker shutdown, not user pause)")
	assert.True(t, IsWorkerShutdown(err))
}

// The Temporal TS worker's drain text — the exact shape captured live in the
// 2026-08-08 incident — crosses as a non-canceled failure and must map.
func TestIsWorkerShutdown_DrainText(t *testing.T) {
	err := temporal.NewApplicationError(
		"Worker is shutting down and this activity did not complete in time", "")
	assert.True(t, IsWorkerShutdown(err))
}

// A wrapped canceled failure (e.g. inside an activity error chain) is still
// recognized — the recognizer walks the Unwrap chain.
func TestIsWorkerShutdown_WrappedCanceledFailure(t *testing.T) {
	err := fmt.Errorf("activity error: %w", canceledWithMessage("worker shutdown"))
	assert.True(t, IsWorkerShutdown(err))
}

// A user pause is a canceled failure too — it must NOT classify as shutdown.
func TestIsWorkerShutdown_PauseIsNotShutdown(t *testing.T) {
	err := canceledWithMessage("Activity paused by orchestrator")
	assert.False(t, IsWorkerShutdown(err))
}

// The loose markers apply ONLY to canceled failures (runner-authored
// messages). An application error that merely echoes "shutting down" —
// plausible in agent/tool output — must not be mistaken for a worker drain.
func TestIsWorkerShutdown_LooseMarkerDoesNotFireOnApplicationErrors(t *testing.T) {
	err := temporal.NewApplicationError(
		"tool failed: the database is shutting down for maintenance", "")
	assert.False(t, IsWorkerShutdown(err))
}

func TestIsWorkerShutdown_UnrelatedFailures(t *testing.T) {
	assert.False(t, IsWorkerShutdown(errors.New("connection refused")))
	assert.False(t, IsWorkerShutdown(temporal.NewApplicationError("model call failed", "")))
	assert.False(t, IsWorkerShutdown(nil))
}

package runner

import (
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// EnsureAction describes what the ensure operation did to satisfy the request.
type EnsureAction string

const (
	// ActionAdoptedExisting means a compatible runner was already active and
	// was adopted as-is. The CLI exits immediately in this case.
	ActionAdoptedExisting EnsureAction = "adopted_existing"

	// ActionStartedFresh means no compatible runner was found, so a new
	// runner process was started. The CLI blocks on the process in this case.
	ActionStartedFresh EnsureAction = "started_fresh"
)

// EnsureResult is the structured output of an ensure operation, designed
// as the machine-readable contract between the CLI and Desktop sidecar.
//
// When --json is passed, this struct is serialized to stdout. Desktop
// parses it to determine what happened and display the appropriate UI.
type EnsureResult struct {
	OK              bool         `json:"ok"`
	Action          EnsureAction `json:"action"`
	RunnerID        string       `json:"runner_id"`
	Name            string       `json:"name"`
	Org             string       `json:"org"`
	PID             int          `json:"pid,omitempty"`
	ContainerID     string       `json:"container_id,omitempty"`
	Runtime         string       `json:"runtime"`
	BackendEndpoint string       `json:"backend_endpoint"`
	TaskQueue       string       `json:"task_queue"`
	StartedAt       time.Time    `json:"started_at"`
	LogFile         string       `json:"log_file,omitempty"`
}

// EnsureError is the structured error output when --json is active and
// the ensure operation fails. Provides a machine-readable error message
// and an optional human-readable hint for resolution.
type EnsureError struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	Hint  string `json:"hint,omitempty"`
}

// WriteJSON serializes the result as indented JSON to w.
func (r *EnsureResult) WriteJSON(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

// WriteJSONError writes a structured error as JSON to w.
func WriteJSONError(w io.Writer, err error, hint string) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(&EnsureError{
		OK:    false,
		Error: err.Error(),
		Hint:  hint,
	})
}

// PrintHumanResult renders an EnsureResult as colored human-readable
// output on stderr. Used when --json is not active.
func PrintHumanResult(result *EnsureResult) {
	switch result.Action {
	case ActionAdoptedExisting:
		climsg.Success("Runner %q is already active (PID %d)", result.Name, result.PID)
		climsg.Info("  Backend: %s", result.BackendEndpoint)
		climsg.Info("  Started: %s", formatRelativeTime(result.StartedAt))
	case ActionStartedFresh:
		climsg.Success("Runner %q started (PID %d)", result.Name, result.PID)
	}
}

// ensureResultFromState builds an EnsureResult for the adoption case
// using the existing on-disk runner state.
func ensureResultFromState(name string, state *RunnerState, action EnsureAction) *EnsureResult {
	result := &EnsureResult{
		OK:              true,
		Action:          action,
		RunnerID:        state.RunnerID,
		Name:            name,
		Org:             state.Org,
		BackendEndpoint: state.BackendEndpoint,
		TaskQueue:       state.TaskQueue,
		StartedAt:       state.StartedAt,
		Runtime:         state.Runtime,
		LogFile:         state.LogFile,
	}
	if result.Runtime == "" {
		result.Runtime = RuntimeNative
	}
	if state.IsDocker() {
		result.ContainerID = state.ContainerID
	} else {
		result.PID = state.PID
	}
	return result
}

// hintForOrgConflict returns a user-actionable hint for org mismatch errors.
func hintForOrgConflict(name string) string {
	return fmt.Sprintf("Stop the existing runner first: stigmer down runner --name %s", name)
}

// hintForEndpointConflict returns a user-actionable hint for endpoint mismatch errors.
func hintForEndpointConflict(name string) string {
	return fmt.Sprintf("Stop the existing runner first: stigmer down runner --name %s", name)
}

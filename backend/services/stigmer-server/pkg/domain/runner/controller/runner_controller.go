package runner

import (
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// RunnerController implements RunnerCommandController and RunnerQueryController.
//
// Runner is its own aggregate root with these invariants:
//   - task_queue is set once at create time ("runner:{id}"), immutable after
//   - status is exclusively managed by the connect stream and server-side transitions, never by update RPC
//   - FAILED phase blocks heartbeat transitions — requires explicit intervention
//   - Identity persists across restarts (apply reactivates, does not recreate)
//
// The StreamRegistry tracks active bidi streams for command routing. It is
// created internally and exposed via GetStreamRegistry for use by the
// sendCommand API handler (T07).
type RunnerController struct {
	runnerv1.UnimplementedRunnerCommandControllerServer
	runnerv1.UnimplementedRunnerQueryControllerServer
	store          store.Store
	streamRegistry *StreamRegistry
}

// NewRunnerController creates a new RunnerController with an initialized StreamRegistry.
func NewRunnerController(store store.Store) *RunnerController {
	return &RunnerController{
		store:          store,
		streamRegistry: NewStreamRegistry(),
	}
}

// GetStreamRegistry returns the stream registry for external command routing.
// Used by the sendCommand API handler to push commands to connected runners.
func (c *RunnerController) GetStreamRegistry() *StreamRegistry {
	return c.streamRegistry
}

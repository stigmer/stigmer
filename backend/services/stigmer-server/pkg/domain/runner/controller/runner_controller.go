package runner

import (
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// RunnerController implements RunnerCommandController and RunnerQueryController.
//
// Runner is its own aggregate root with these invariants:
//   - task_queue is set once at create time ("runner:{id}"), immutable after
//   - status is exclusively managed by heartbeat and server-side transitions, never by update RPC
//   - FAILED phase blocks heartbeat transitions — requires explicit intervention
//   - Identity persists across restarts (apply reactivates, does not recreate)
//
// No cross-aggregate dependencies: unlike Agent (which creates a default AgentInstance),
// Runner is self-contained. No downstream clients are needed.
type RunnerController struct {
	runnerv1.UnimplementedRunnerCommandControllerServer
	runnerv1.UnimplementedRunnerQueryControllerServer
	store store.Store
}

// NewRunnerController creates a new RunnerController.
func NewRunnerController(store store.Store) *RunnerController {
	return &RunnerController{
		store: store,
	}
}

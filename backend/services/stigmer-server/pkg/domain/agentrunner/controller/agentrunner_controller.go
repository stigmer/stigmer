package agentrunner

import (
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentRunnerController implements AgentRunnerCommandController and AgentRunnerQueryController.
//
// AgentRunner is its own aggregate root with these invariants:
//   - task_queue is set once at create time ("agent-runner:{id}"), immutable after
//   - status is exclusively managed by heartbeat and server-side transitions, never by update RPC
//   - FAILED phase blocks heartbeat transitions — requires explicit intervention
//   - Identity persists across restarts (apply reactivates, does not recreate)
//
// No cross-aggregate dependencies: unlike Agent (which creates a default AgentInstance),
// AgentRunner is self-contained. No downstream clients are needed.
type AgentRunnerController struct {
	agentrunnerv1.UnimplementedAgentRunnerCommandControllerServer
	agentrunnerv1.UnimplementedAgentRunnerQueryControllerServer
	store store.Store
}

// NewAgentRunnerController creates a new AgentRunnerController.
func NewAgentRunnerController(store store.Store) *AgentRunnerController {
	return &AgentRunnerController{
		store: store,
	}
}

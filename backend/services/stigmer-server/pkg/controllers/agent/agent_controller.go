package agent

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// AgentController implements AgentCommandController and AgentQueryController
type AgentController struct {
	agentv1.UnimplementedAgentCommandControllerServer
	agentv1.UnimplementedAgentQueryControllerServer
	store *badger.Store
}

// NewAgentController creates a new AgentController
func NewAgentController(store *badger.Store) *AgentController {
	return &AgentController{store: store}
}

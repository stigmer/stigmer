package agentinstance

import (
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentInstanceController implements AgentInstanceCommandController and AgentInstanceQueryController
type AgentInstanceController struct {
	agentinstancev1.UnimplementedAgentInstanceCommandControllerServer
	agentinstancev1.UnimplementedAgentInstanceQueryControllerServer
	store store.Store
}

// NewAgentInstanceController creates a new AgentInstanceController
func NewAgentInstanceController(store store.Store) *AgentInstanceController {
	return &AgentInstanceController{store: store}
}

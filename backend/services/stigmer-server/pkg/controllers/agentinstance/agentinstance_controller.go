package agentinstance

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// AgentInstanceController implements AgentInstanceCommandController and AgentInstanceQueryService
type AgentInstanceController struct {
	agentinstancev1.UnimplementedAgentInstanceCommandControllerServer
	agentinstancev1.UnimplementedAgentInstanceQueryServiceServer
	store *badger.Store
}

// NewAgentInstanceController creates a new AgentInstanceController
func NewAgentInstanceController(store *badger.Store) *AgentInstanceController {
	return &AgentInstanceController{store: store}
}

package agentinstance

import (
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
)

// AgentInstanceController implements AgentInstanceCommandController and AgentInstanceQueryController
type AgentInstanceController struct {
	agentinstancev1.UnimplementedAgentInstanceCommandControllerServer
	agentinstancev1.UnimplementedAgentInstanceQueryControllerServer
	store       store.Store
	agentClient *agent.Client
}

// NewAgentInstanceController creates a new AgentInstanceController
func NewAgentInstanceController(store store.Store, agentClient *agent.Client) *AgentInstanceController {
	return &AgentInstanceController{
		store:       store,
		agentClient: agentClient,
	}
}

// SetAgentClient sets the Agent client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *AgentInstanceController) SetAgentClient(client *agent.Client) {
	c.agentClient = client
}

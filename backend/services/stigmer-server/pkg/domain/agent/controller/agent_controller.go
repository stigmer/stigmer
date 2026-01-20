package agent

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
)

// AgentController implements AgentCommandController and AgentQueryController
type AgentController struct {
	agentv1.UnimplementedAgentCommandControllerServer
	agentv1.UnimplementedAgentQueryControllerServer
	store                  *badger.Store
	agentInstanceClient    *agentinstance.Client
}

// NewAgentController creates a new AgentController
func NewAgentController(store *badger.Store, agentInstanceClient *agentinstance.Client) *AgentController {
	return &AgentController{
		store:               store,
		agentInstanceClient: agentInstanceClient,
	}
}

// SetAgentInstanceClient sets the AgentInstance client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *AgentController) SetAgentInstanceClient(client *agentinstance.Client) {
	c.agentInstanceClient = client
}

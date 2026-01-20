package agentexecution

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// AgentExecutionController implements AgentExecutionCommandController and AgentExecutionQueryController
type AgentExecutionController struct {
	agentexecutionv1.UnimplementedAgentExecutionCommandControllerServer
	agentexecutionv1.UnimplementedAgentExecutionQueryControllerServer
	store               *badger.Store
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
	sessionClient       *session.Client
	workflowCreator     *temporal.InvokeAgentExecutionWorkflowCreator
	streamBroker        *StreamBroker
}

// NewAgentExecutionController creates a new AgentExecutionController
//
// Parameters:
//   - store: BadgerDB store for persistence
//   - agentClient: In-process gRPC client for Agent service
//   - agentInstanceClient: In-process gRPC client for AgentInstance service
//   - sessionClient: In-process gRPC client for Session service
//
// Note: All clients use in-process gRPC to ensure single source of truth through
// the full interceptor chain (validation, logging, api_resource_kind injection, etc.)
func NewAgentExecutionController(
	store *badger.Store,
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
	sessionClient *session.Client,
) *AgentExecutionController {
	return &AgentExecutionController{
		store:               store,
		agentClient:         agentClient,
		agentInstanceClient: agentInstanceClient,
		sessionClient:       sessionClient,
		streamBroker:        NewStreamBroker(),
	}
}

// SetClients sets the client dependencies
// This is used when the controller is created before the in-process gRPC server is started
func (c *AgentExecutionController) SetClients(
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
	sessionClient *session.Client,
) {
	c.agentClient = agentClient
	c.agentInstanceClient = agentInstanceClient
	c.sessionClient = sessionClient
}

// SetWorkflowCreator sets the Temporal workflow creator dependency
// This is used when the controller is created before the Temporal client is initialized
// If nil, workflows will not be started (graceful degradation)
func (c *AgentExecutionController) SetWorkflowCreator(creator *temporal.InvokeAgentExecutionWorkflowCreator) {
	c.workflowCreator = creator
}

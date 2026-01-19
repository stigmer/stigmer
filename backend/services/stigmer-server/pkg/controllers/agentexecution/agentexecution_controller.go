package agentexecution

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
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

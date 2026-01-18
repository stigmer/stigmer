package agentexecution

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
)

// AgentExecutionController implements AgentExecutionCommandController and AgentExecutionQueryController
type AgentExecutionController struct {
	agentexecutionv1.UnimplementedAgentExecutionCommandControllerServer
	agentexecutionv1.UnimplementedAgentExecutionQueryControllerServer
	store               *badger.Store
	agentInstanceClient *agentinstance.Client
	sessionClient       *session.Client
}

// NewAgentExecutionController creates a new AgentExecutionController
//
// Parameters:
//   - store: BadgerDB store for persistence
//   - agentInstanceClient: In-process gRPC client for AgentInstance service
//   - sessionClient: In-process gRPC client for Session service (can be nil)
//
// Note: If sessionClient is nil, session creation will fall back to direct store access.
// TODO: Once Session controller is implemented, pass non-nil sessionClient.
func NewAgentExecutionController(
	store *badger.Store,
	agentInstanceClient *agentinstance.Client,
	sessionClient *session.Client,
) *AgentExecutionController {
	return &AgentExecutionController{
		store:               store,
		agentInstanceClient: agentInstanceClient,
		sessionClient:       sessionClient,
	}
}

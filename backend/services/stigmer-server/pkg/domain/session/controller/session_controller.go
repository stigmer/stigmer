package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
)

// SessionController implements SessionCommandController and SessionQueryController
type SessionController struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	sessionv1.UnimplementedSessionQueryControllerServer
	store               store.Store
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
}

// NewSessionController creates a new SessionController
//
// Parameters:
//   - store: Store for persistence
func NewSessionController(store store.Store) *SessionController {
	return &SessionController{
		store: store,
	}
}

// SetClients injects downstream gRPC clients after the in-process connection
// is established. This breaks the circular dependency between controller
// registration and client creation.
func (c *SessionController) SetClients(
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
) {
	c.agentClient = agentClient
	c.agentInstanceClient = agentInstanceClient
}

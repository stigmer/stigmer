package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
)

// SessionController implements SessionCommandController and SessionQueryController
type SessionController struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	sessionv1.UnimplementedSessionQueryControllerServer
	store               store.Store
	temporalConfig      *agentexecutiontemporal.Config
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
}

// NewSessionController creates a new SessionController
//
// Parameters:
//   - store: Store for persistence
//   - temporalConfig: agent execution temporal config; the update pipeline's
//     execution-target immutability step resolves UNSPECIFIED through the same
//     deployment default dispatch uses (oss#397)
func NewSessionController(store store.Store, temporalConfig *agentexecutiontemporal.Config) *SessionController {
	return &SessionController{
		store:          store,
		temporalConfig: temporalConfig,
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

package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// SessionController implements SessionCommandController and SessionQueryController
type SessionController struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	sessionv1.UnimplementedSessionQueryControllerServer
	store store.Store
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

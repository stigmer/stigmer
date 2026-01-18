package session

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)

// SessionController implements SessionCommandController and SessionQueryController
type SessionController struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	sessionv1.UnimplementedSessionQueryControllerServer
	store *badger.Store
}

// NewSessionController creates a new SessionController
//
// Parameters:
//   - store: BadgerDB store for persistence
func NewSessionController(store *badger.Store) *SessionController {
	return &SessionController{
		store: store,
	}
}

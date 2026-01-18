package environment

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	environmentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/environment/v1"
)

// EnvironmentController implements EnvironmentCommandController and EnvironmentQueryController
type EnvironmentController struct {
	environmentv1.UnimplementedEnvironmentCommandControllerServer
	environmentv1.UnimplementedEnvironmentQueryControllerServer
	store *badger.Store
}

// NewEnvironmentController creates a new EnvironmentController
func NewEnvironmentController(store *badger.Store) *EnvironmentController {
	return &EnvironmentController{
		store: store,
	}
}

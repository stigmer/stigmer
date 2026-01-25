package environment

import (
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// EnvironmentController implements EnvironmentCommandController and EnvironmentQueryController
type EnvironmentController struct {
	environmentv1.UnimplementedEnvironmentCommandControllerServer
	environmentv1.UnimplementedEnvironmentQueryControllerServer
	store store.Store
}

// NewEnvironmentController creates a new EnvironmentController
func NewEnvironmentController(store store.Store) *EnvironmentController {
	return &EnvironmentController{
		store: store,
	}
}

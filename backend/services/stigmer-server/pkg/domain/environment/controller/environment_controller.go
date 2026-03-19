package environment

import (
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// EnvironmentController implements EnvironmentCommandController and EnvironmentQueryController
type EnvironmentController struct {
	environmentv1.UnimplementedEnvironmentCommandControllerServer
	environmentv1.UnimplementedEnvironmentQueryControllerServer
	store         store.Store
	secretService *encryption.SecretService
}

// NewEnvironmentController creates a new EnvironmentController
func NewEnvironmentController(store store.Store, secretService *encryption.SecretService) *EnvironmentController {
	return &EnvironmentController{
		store:         store,
		secretService: secretService,
	}
}

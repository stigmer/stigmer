package executioncontext

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	executioncontextv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/executioncontext/v1"
)

// ExecutionContextController implements ExecutionContextCommandController and ExecutionContextQueryController
type ExecutionContextController struct {
	executioncontextv1.UnimplementedExecutionContextCommandControllerServer
	executioncontextv1.UnimplementedExecutionContextQueryControllerServer
	store *badger.Store
}

// NewExecutionContextController creates a new ExecutionContextController
func NewExecutionContextController(store *badger.Store) *ExecutionContextController {
	return &ExecutionContextController{
		store: store,
	}
}

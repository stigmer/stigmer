package executioncontext

import (
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ExecutionContextController implements ExecutionContextCommandController and ExecutionContextQueryController
type ExecutionContextController struct {
	executioncontextv1.UnimplementedExecutionContextCommandControllerServer
	executioncontextv1.UnimplementedExecutionContextQueryControllerServer
	store store.Store
}

// NewExecutionContextController creates a new ExecutionContextController
func NewExecutionContextController(store store.Store) *ExecutionContextController {
	return &ExecutionContextController{
		store: store,
	}
}

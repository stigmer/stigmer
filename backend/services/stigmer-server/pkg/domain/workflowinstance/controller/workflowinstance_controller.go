package workflowinstance

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
)

// WorkflowInstanceController implements WorkflowInstanceCommandController and WorkflowInstanceQueryController
type WorkflowInstanceController struct {
	workflowinstancev1.UnimplementedWorkflowInstanceCommandControllerServer
	workflowinstancev1.UnimplementedWorkflowInstanceQueryControllerServer
	store          *badger.Store
	workflowClient *workflow.Client
}

// NewWorkflowInstanceController creates a new WorkflowInstanceController
func NewWorkflowInstanceController(store *badger.Store, workflowClient *workflow.Client) *WorkflowInstanceController {
	return &WorkflowInstanceController{
		store:          store,
		workflowClient: workflowClient,
	}
}

// SetWorkflowClient sets the Workflow client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *WorkflowInstanceController) SetWorkflowClient(client *workflow.Client) {
	c.workflowClient = client
}

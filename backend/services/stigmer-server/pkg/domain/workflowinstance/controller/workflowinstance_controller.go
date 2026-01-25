package workflowinstance

import (
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
)

// WorkflowInstanceController implements WorkflowInstanceCommandController and WorkflowInstanceQueryController
type WorkflowInstanceController struct {
	workflowinstancev1.UnimplementedWorkflowInstanceCommandControllerServer
	workflowinstancev1.UnimplementedWorkflowInstanceQueryControllerServer
	store          store.Store
	workflowClient *workflow.Client
}

// NewWorkflowInstanceController creates a new WorkflowInstanceController
func NewWorkflowInstanceController(store store.Store, workflowClient *workflow.Client) *WorkflowInstanceController {
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

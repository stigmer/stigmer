package workflow

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// WorkflowController implements WorkflowCommandController and WorkflowQueryController
type WorkflowController struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	workflowv1.UnimplementedWorkflowQueryControllerServer
	store                    *badger.Store
	workflowInstanceClient   *workflowinstance.Client
}

// NewWorkflowController creates a new WorkflowController
func NewWorkflowController(store *badger.Store, workflowInstanceClient *workflowinstance.Client) *WorkflowController {
	return &WorkflowController{
		store:                  store,
		workflowInstanceClient: workflowInstanceClient,
	}
}

// SetWorkflowInstanceClient sets the WorkflowInstance client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *WorkflowController) SetWorkflowInstanceClient(client *workflowinstance.Client) {
	c.workflowInstanceClient = client
}

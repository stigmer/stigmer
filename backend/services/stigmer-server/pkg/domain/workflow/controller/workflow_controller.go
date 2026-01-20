package workflow

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// WorkflowController implements WorkflowCommandController and WorkflowQueryController
type WorkflowController struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	workflowv1.UnimplementedWorkflowQueryControllerServer
	store                    *badger.Store
	workflowInstanceClient   *workflowinstance.Client
	validator                *temporal.ServerlessWorkflowValidator
}

// NewWorkflowController creates a new WorkflowController
func NewWorkflowController(store *badger.Store, workflowInstanceClient *workflowinstance.Client, validator *temporal.ServerlessWorkflowValidator) *WorkflowController {
	return &WorkflowController{
		store:                  store,
		workflowInstanceClient: workflowInstanceClient,
		validator:              validator,
	}
}

// SetWorkflowInstanceClient sets the WorkflowInstance client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *WorkflowController) SetWorkflowInstanceClient(client *workflowinstance.Client) {
	c.workflowInstanceClient = client
}

package workflow

import (
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
)

// WorkflowController implements WorkflowCommandController and WorkflowQueryController
type WorkflowController struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	workflowv1.UnimplementedWorkflowQueryControllerServer
	store                  store.Store
	workflowInstanceClient *workflowinstance.Client
	validator              *temporal.ServerlessWorkflowValidator
}

// NewWorkflowController creates a new WorkflowController
func NewWorkflowController(store store.Store, workflowInstanceClient *workflowinstance.Client, validator *temporal.ServerlessWorkflowValidator) *WorkflowController {
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

// SetValidator sets the Temporal workflow validator dependency
// This is used when the controller is created before the Temporal client is initialized
// or when the Temporal client is reconnected
func (c *WorkflowController) SetValidator(validator *temporal.ServerlessWorkflowValidator) {
	c.validator = validator
}

package workflow

import (
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
)

// WorkflowController implements WorkflowCommandController and WorkflowQueryController
type WorkflowController struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	workflowv1.UnimplementedWorkflowQueryControllerServer
	store                  store.Store
	workflowInstanceClient *workflowinstance.Client
	validator              validation.WorkflowValidator
}

// NewWorkflowController creates a new WorkflowController
func NewWorkflowController(store store.Store, workflowInstanceClient *workflowinstance.Client, validator validation.WorkflowValidator) *WorkflowController {
	return &WorkflowController{
		store:                  store,
		workflowInstanceClient: workflowInstanceClient,
		validator:              validator,
	}
}

// SetWorkflowInstanceClient sets the WorkflowInstance client dependency
func (c *WorkflowController) SetWorkflowInstanceClient(client *workflowinstance.Client) {
	c.workflowInstanceClient = client
}

// SetValidator sets the workflow validator dependency
func (c *WorkflowController) SetValidator(validator validation.WorkflowValidator) {
	c.validator = validator
}

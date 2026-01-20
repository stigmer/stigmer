package workflowexecution

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// WorkflowExecutionController implements WorkflowExecutionCommandController and WorkflowExecutionQueryController
//
// This controller handles workflow execution lifecycle operations following the Template→Instance→Execution pattern.
// WorkflowExecution is the "Execution" layer - ephemeral runtime invocations that execute tasks and track progress.
//
// Architecture:
// - Workflow (template): Orchestration definition
// - WorkflowInstance (configuration): Environment bindings and default values
// - WorkflowExecution (runtime): Single execution run with inputs, state, and results
//
// Domain Separation:
// - Uses downstream workflowinstance client for cross-domain operations
// - Loads workflows directly from store (same service)
// - WorkflowInstance calls are in-process gRPC (full interceptor chain)
// - Maintains clean domain boundaries for future microservice migration
//
// Streaming (ADR 011):
// - streamBroker manages in-memory Go channels for real-time updates
// - UpdateStatus broadcasts to subscribers after persisting to database
// - Subscribe() provides streaming updates without polling
type WorkflowExecutionController struct {
	workflowexecutionv1.UnimplementedWorkflowExecutionCommandControllerServer
	workflowexecutionv1.UnimplementedWorkflowExecutionQueryControllerServer
	store                  *badger.Store
	workflowInstanceClient *workflowinstance.Client
	workflowCreator        *workflows.InvokeWorkflowExecutionWorkflowCreator
	streamBroker           *StreamBroker
}

// NewWorkflowExecutionController creates a new WorkflowExecutionController
//
// Parameters:
// - store: BadgerDB store for persistence (also used to load workflows)
// - workflowInstanceClient: Client for instance creation (auto-create default instances)
func NewWorkflowExecutionController(
	store *badger.Store,
	workflowInstanceClient *workflowinstance.Client,
) *WorkflowExecutionController {
	return &WorkflowExecutionController{
		store:                  store,
		workflowInstanceClient: workflowInstanceClient,
		streamBroker:           NewStreamBroker(),
	}
}

// SetWorkflowInstanceClient sets the WorkflowInstance client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *WorkflowExecutionController) SetWorkflowInstanceClient(client *workflowinstance.Client) {
	c.workflowInstanceClient = client
}

// SetWorkflowCreator sets the Temporal workflow creator dependency
// This is used when the controller is created before the Temporal client is initialized
// If nil, workflows will not be started (graceful degradation)
func (c *WorkflowExecutionController) SetWorkflowCreator(creator *workflows.InvokeWorkflowExecutionWorkflowCreator) {
	c.workflowCreator = creator
}

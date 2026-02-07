package workflowexecution

import (
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"go.temporal.io/sdk/client"
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
//
// HITL Approval (Phase 5.3):
// - agentExecutionClient enables approval forwarding to child agent executions
// - WorkflowExecution.SubmitApproval delegates to child AgentExecution
type WorkflowExecutionController struct {
	workflowexecutionv1.UnimplementedWorkflowExecutionCommandControllerServer
	workflowexecutionv1.UnimplementedWorkflowExecutionQueryControllerServer
	store                  store.Store
	workflowInstanceClient *workflowinstance.Client
	workflowCreator        *workflows.InvokeWorkflowExecutionWorkflowCreator
	streamBroker           *StreamBroker
	agentExecutionClient   AgentExecutionApprovalClient // For forwarding approvals to child agents
	temporalClient         client.Client                // For lifecycle operations (cancel, terminate, recover)
}

// NewWorkflowExecutionController creates a new WorkflowExecutionController
//
// Parameters:
// - store: Store for persistence (also used to load workflows)
// - workflowInstanceClient: Client for instance creation (auto-create default instances)
func NewWorkflowExecutionController(
	store store.Store,
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

// GetStreamBroker returns the stream broker for use by Temporal activities
// This allows workflow error recovery to broadcast status updates to subscribers
func (c *WorkflowExecutionController) GetStreamBroker() *StreamBroker {
	return c.streamBroker
}

// SetAgentExecutionClient sets the AgentExecution client dependency for approval forwarding
// This is used when the controller is created before the in-process gRPC server is started
// If nil, approval forwarding will be skipped (graceful degradation)
func (c *WorkflowExecutionController) SetAgentExecutionClient(client AgentExecutionApprovalClient) {
	c.agentExecutionClient = client
}

// SetTemporalClient sets the Temporal client for lifecycle operations (cancel, terminate, recover)
// This is used when the controller is created before the Temporal client is initialized
// If nil, lifecycle operations will return an error indicating Temporal is unavailable
func (c *WorkflowExecutionController) SetTemporalClient(tc client.Client) {
	c.temporalClient = tc
}

// GetTemporalClient returns the Temporal client for lifecycle operations
// Used by pipeline steps that need to interact with Temporal
func (c *WorkflowExecutionController) GetTemporalClient() client.Client {
	return c.temporalClient
}

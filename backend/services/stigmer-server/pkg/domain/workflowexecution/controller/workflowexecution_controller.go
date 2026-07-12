package workflowexecution

import (
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe"
	wftemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
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
	store                            store.Store
	workflowInstanceClient           *workflowinstance.Client
	environmentClient                *environment.Client
	executionContextClient           *executioncontext.Client
	workflowCreator                  *workflows.InvokeWorkflowExecutionWorkflowCreator
	streamBroker                     *StreamBroker
	agentExecutionClient             AgentExecutionApprovalClient     // For forwarding approvals to child agents
	agentExecutionFileDecisionClient AgentExecutionFileDecisionClient // For forwarding file decisions to child agents
	temporalClient                   client.Client                    // For lifecycle operations (cancel, terminate, recover)
	signalDedupeStore                dedupe.SignalDedupeStore         // For signal deduplication (Gap B2)
	temporalConfig                   *wftemporal.Config               // For workflow dispatch routing (sandbox affinity)
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
		temporalConfig:         wftemporal.LoadConfig(),
	}
}

// SetWorkflowInstanceClient sets the WorkflowInstance client dependency
// This is used when the controller is created before the in-process gRPC server is started
func (c *WorkflowExecutionController) SetWorkflowInstanceClient(client *workflowinstance.Client) {
	c.workflowInstanceClient = client
}

// SetEnvironmentAndExecutionContextClients sets the clients needed for ExecutionContext creation
// during the create pipeline. These are injected after the in-process gRPC server starts.
func (c *WorkflowExecutionController) SetEnvironmentAndExecutionContextClients(
	envClient *environment.Client,
	ecClient *executioncontext.Client,
) {
	c.environmentClient = envClient
	c.executionContextClient = ecClient
}

// SetWorkflowCreator sets the Temporal workflow creator dependency
// This is used when the controller is created before the Temporal client is initialized.
// While nil (the startup window before Temporal first connects, or after a failed
// initial connection), Create rejects new executions with Unavailable via
// ensureEngineAvailableStep rather than persisting executions that could never run.
// TemporalManager re-injects the creator once Temporal connects.
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

// SetAgentExecutionFileDecisionClient sets the AgentExecution client dependency for
// file-decision forwarding (the file-review sibling of SetAgentExecutionClient).
// If nil, file-decision forwarding is skipped (graceful degradation).
func (c *WorkflowExecutionController) SetAgentExecutionFileDecisionClient(client AgentExecutionFileDecisionClient) {
	c.agentExecutionFileDecisionClient = client
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

// SetSignalDedupeStore sets the signal dedupe store for idempotent signal delivery
// This is used when the controller is created before the database is initialized
// If nil, signal deduplication will be skipped (graceful degradation)
//
// @since Gap B2 (Event Dedupe)
func (c *WorkflowExecutionController) SetSignalDedupeStore(dedupeStore dedupe.SignalDedupeStore) {
	c.signalDedupeStore = dedupeStore
}

// GetSignalDedupeStore returns the signal dedupe store
// Used by pipeline steps that need to check/update dedupe records
func (c *WorkflowExecutionController) GetSignalDedupeStore() dedupe.SignalDedupeStore {
	return c.signalDedupeStore
}

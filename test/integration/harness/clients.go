package harness

import (
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	"google.golang.org/grpc"
)

// Clients holds typed gRPC clients for all workflow-related services.
// It is intentionally a thin wrapper — no logic, no lifecycle management.
type Clients struct {
	WorkflowCommand     workflowv1.WorkflowCommandControllerClient
	WorkflowQuery       workflowv1.WorkflowQueryControllerClient
	InstanceCommand     workflowinstancev1.WorkflowInstanceCommandControllerClient
	InstanceQuery       workflowinstancev1.WorkflowInstanceQueryControllerClient
	ExecutionCommand    workflowexecutionv1.WorkflowExecutionCommandControllerClient
	ExecutionQuery      workflowexecutionv1.WorkflowExecutionQueryControllerClient
	AgentCommand        agentv1.AgentCommandControllerClient
	AgentExecutionQuery agentexecv1.AgentExecutionQueryControllerClient
	SessionQuery        sessionv1.SessionQueryControllerClient
	BillingCommand      billingv1.BillingCommandControllerClient
}

// NewClients creates all typed gRPC clients from a single connection.
func NewClients(conn grpc.ClientConnInterface) *Clients {
	return &Clients{
		WorkflowCommand:     workflowv1.NewWorkflowCommandControllerClient(conn),
		WorkflowQuery:       workflowv1.NewWorkflowQueryControllerClient(conn),
		InstanceCommand:     workflowinstancev1.NewWorkflowInstanceCommandControllerClient(conn),
		InstanceQuery:       workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn),
		ExecutionCommand:    workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn),
		ExecutionQuery:      workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn),
		AgentCommand:        agentv1.NewAgentCommandControllerClient(conn),
		AgentExecutionQuery: agentexecv1.NewAgentExecutionQueryControllerClient(conn),
		SessionQuery:        sessionv1.NewSessionQueryControllerClient(conn),
		BillingCommand:      billingv1.NewBillingCommandControllerClient(conn),
	}
}

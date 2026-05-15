package harness

import (
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	"google.golang.org/grpc"
)

// Clients holds typed gRPC clients for all services under test.
// It is intentionally a thin wrapper — no logic, no lifecycle management.
type Clients struct {
	// Workflow services
	WorkflowCommand  workflowv1.WorkflowCommandControllerClient
	WorkflowQuery    workflowv1.WorkflowQueryControllerClient
	InstanceCommand  workflowinstancev1.WorkflowInstanceCommandControllerClient
	InstanceQuery    workflowinstancev1.WorkflowInstanceQueryControllerClient
	ExecutionCommand workflowexecutionv1.WorkflowExecutionCommandControllerClient
	ExecutionQuery   workflowexecutionv1.WorkflowExecutionQueryControllerClient

	// Agent services
	AgentCommand         agentv1.AgentCommandControllerClient
	AgentExecutionCommand agentexecv1.AgentExecutionCommandControllerClient
	AgentExecutionQuery  agentexecv1.AgentExecutionQueryControllerClient

	// Session services
	SessionCommand sessionv1.SessionCommandControllerClient
	SessionQuery   sessionv1.SessionQueryControllerClient

	// MCP Server services
	McpServerCommand mcpserverv1.McpServerCommandControllerClient
	McpServerQuery   mcpserverv1.McpServerQueryControllerClient

	// Skill services
	SkillCommand skillv1.SkillCommandControllerClient
	SkillQuery   skillv1.SkillQueryControllerClient

	// Billing
	BillingCommand billingv1.BillingCommandControllerClient
}

// NewClients creates all typed gRPC clients from a single connection.
func NewClients(conn grpc.ClientConnInterface) *Clients {
	return &Clients{
		WorkflowCommand:  workflowv1.NewWorkflowCommandControllerClient(conn),
		WorkflowQuery:    workflowv1.NewWorkflowQueryControllerClient(conn),
		InstanceCommand:  workflowinstancev1.NewWorkflowInstanceCommandControllerClient(conn),
		InstanceQuery:    workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn),
		ExecutionCommand: workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn),
		ExecutionQuery:   workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn),

		AgentCommand:         agentv1.NewAgentCommandControllerClient(conn),
		AgentExecutionCommand: agentexecv1.NewAgentExecutionCommandControllerClient(conn),
		AgentExecutionQuery:  agentexecv1.NewAgentExecutionQueryControllerClient(conn),

		SessionCommand: sessionv1.NewSessionCommandControllerClient(conn),
		SessionQuery:   sessionv1.NewSessionQueryControllerClient(conn),

		McpServerCommand: mcpserverv1.NewMcpServerCommandControllerClient(conn),
		McpServerQuery:   mcpserverv1.NewMcpServerQueryControllerClient(conn),

		SkillCommand: skillv1.NewSkillCommandControllerClient(conn),
		SkillQuery:   skillv1.NewSkillQueryControllerClient(conn),

		BillingCommand: billingv1.NewBillingCommandControllerClient(conn),
	}
}

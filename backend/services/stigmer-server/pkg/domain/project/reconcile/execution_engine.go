package reconcile

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ResourceDeleter deletes a resource by kind and ID.
//
// This is the only execution capability the reconciliation engine needs
// in the reference-based model. Resources are created/updated individually
// by the CLI; the server only deletes orphans during reconciliation.
type ResourceDeleter interface {
	Delete(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceID string) error
}

// DownstreamClients holds references to all downstream resource clients.
//
// Only Delete methods are used by the reconciliation engine. The full client
// interfaces are retained because they are shared with other components
// (e.g., bootstrap).
type DownstreamClients struct {
	AgentClient     AgentClient
	WorkflowClient  WorkflowClient
	McpServerClient McpServerClient
	SkillClient     SkillClient
}

// AgentClient defines the agent operations needed by downstream consumers.
type AgentClient interface {
	Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	Delete(ctx context.Context, resourceID string) (*agentv1.Agent, error)
}

// WorkflowClient defines the workflow operations needed by downstream consumers.
type WorkflowClient interface {
	Create(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	Delete(ctx context.Context, resourceID string) (*workflowv1.Workflow, error)
}

// McpServerClient defines the MCP server operations needed by downstream consumers.
type McpServerClient interface {
	Create(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	Update(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	Delete(ctx context.Context, resourceID string) (*mcpserverv1.McpServer, error)
}

// SkillClient defines the skill operations needed by downstream consumers.
type SkillClient interface {
	Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error)
	Delete(ctx context.Context, resourceID string) (*skillv1.Skill, error)
}

// ResourceDeleterAdapter adapts DownstreamClients to the ResourceDeleter interface.
//
// It routes delete calls to the appropriate downstream client based on resource kind.
type ResourceDeleterAdapter struct {
	clients *DownstreamClients
}

// NewResourceDeleterAdapter creates a new adapter from downstream clients.
func NewResourceDeleterAdapter(clients *DownstreamClients) *ResourceDeleterAdapter {
	return &ResourceDeleterAdapter{clients: clients}
}

// Delete routes to the appropriate downstream client's Delete method.
func (a *ResourceDeleterAdapter) Delete(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceID string) error {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent:
		_, err := a.clients.AgentClient.Delete(ctx, resourceID)
		return err
	case apiresourcekind.ApiResourceKind_workflow:
		_, err := a.clients.WorkflowClient.Delete(ctx, resourceID)
		return err
	case apiresourcekind.ApiResourceKind_mcp_server:
		_, err := a.clients.McpServerClient.Delete(ctx, resourceID)
		return err
	case apiresourcekind.ApiResourceKind_skill:
		_, err := a.clients.SkillClient.Delete(ctx, resourceID)
		return err
	default:
		return fmt.Errorf("unsupported resource kind for delete: %v", kind)
	}
}

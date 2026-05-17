// Package server initializes the MCP server, registers all tools, and exposes
// the transport entry points (STDIO and HTTP).
//
// The server is stateless — all per-request state (API key, gRPC connection)
// is derived from the context that the transport injects. This means the same
// mcp.Server instance can safely serve both STDIO and HTTP concurrently.
package server

import (
	"context"
	"log/slog"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/config"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/agents"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/mcpservers"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/search"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/skills"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/workflowexecutions"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/workflows"
)

// Server wraps an mcp.Server with Stigmer-specific configuration.
type Server struct {
	mcp    *mcp.Server
	config *config.Config
}

// New creates a configured MCP server with all Stigmer tools registered.
func New(cfg *config.Config) *Server {
	srv := mcp.NewServer(
		&mcp.Implementation{
			Name:    "mcp-server-stigmer",
			Version: version(),
		},
		nil,
	)

	registerTools(srv, cfg.StigmerServerAddress)
	registerResources(srv, cfg.StigmerServerAddress)

	return &Server{
		mcp:    srv,
		config: cfg,
	}
}

// registerTools wires up every domain tool. The serverAddress is captured in
// each handler's closure so that tool handlers can create gRPC connections
// without reaching back into the config layer.
func registerTools(srv *mcp.Server, serverAddress string) {
	// Read tools
	mcp.AddTool(srv, search.Tool(), search.Handler(serverAddress))
	mcp.AddTool(srv, agents.Tool(), agents.Handler(serverAddress))
	mcp.AddTool(srv, mcpservers.Tool(), mcpservers.Handler(serverAddress))
	mcp.AddTool(srv, skills.Tool(), skills.Handler(serverAddress))
	mcp.AddTool(srv, workflows.Tool(), workflows.Handler(serverAddress))

	// Write tools — apply (create or update)
	mcp.AddTool(srv, agents.ApplyTool(), agents.ApplyHandler(serverAddress))
	mcp.AddTool(srv, mcpservers.ApplyTool(), mcpservers.ApplyHandler(serverAddress))
	// TODO: apply_workflow is temporarily disabled due to a recursive type
	// cycle in WorkflowTaskInput that jsonschema-go v0.4.2 cannot handle.
	// See: https://github.com/stigmer/stigmer/issues/TBD
	// mcp.AddTool(srv, workflows.ApplyTool(), workflows.ApplyHandler(serverAddress))

	// Write tools — delete
	mcp.AddTool(srv, agents.DeleteTool(), agents.DeleteHandler(serverAddress))
	mcp.AddTool(srv, mcpservers.DeleteTool(), mcpservers.DeleteHandler(serverAddress))
	mcp.AddTool(srv, skills.DeleteTool(), skills.DeleteHandler(serverAddress))
	mcp.AddTool(srv, workflows.DeleteTool(), workflows.DeleteHandler(serverAddress))

	// Workflow-specific tools — task registry, validation, execution introspection
	mcp.AddTool(srv, workflows.GetTaskKindRegistryTool(), workflows.GetTaskKindRegistryHandler(serverAddress))
	mcp.AddTool(srv, workflows.GetTaskKindTool(), workflows.GetTaskKindHandler(serverAddress))
	mcp.AddTool(srv, workflows.ValidateWorkflowYamlTool(), workflows.ValidateWorkflowYamlHandler(serverAddress))
	mcp.AddTool(srv, workflowexecutions.GetWorkflowExecutionTool(), workflowexecutions.GetWorkflowExecutionHandler(serverAddress))
	mcp.AddTool(srv, workflowexecutions.GetWorkflowExecutionEventsTool(), workflowexecutions.GetWorkflowExecutionEventsHandler(serverAddress))

	slog.Info("tools registered", "count", 16, "tools", []string{
		"search",
		"get_agent", "get_mcp_server", "get_skill", "get_workflow",
		"apply_agent", "apply_mcp_server",
		"delete_agent", "delete_mcp_server", "delete_skill", "delete_workflow",
		"get_task_kind_registry", "get_task_kind", "validate_workflow_yaml",
		"get_workflow_execution", "get_workflow_execution_events",
	})
}

// registerResources wires up the URI-addressable resource templates. These
// provide a complementary read path to tools: MCP clients that already know a
// resource URI can read it directly without calling a tool.
func registerResources(srv *mcp.Server, serverAddress string) {
	srv.AddResourceTemplate(agents.Template(), agents.ResourceHandler(serverAddress))
	srv.AddResourceTemplate(mcpservers.Template(), mcpservers.ResourceHandler(serverAddress))
	srv.AddResourceTemplate(skills.Template(), skills.ResourceHandler(serverAddress))
	srv.AddResourceTemplate(skills.VersionedTemplate(), skills.VersionedResourceHandler(serverAddress))
	srv.AddResourceTemplate(workflows.Template(), workflows.ResourceHandler(serverAddress))

	slog.Info("resource templates registered", "count", 5,
		"templates", []string{
			"stigmer://agents/{org}/{slug}",
			"stigmer://mcp-servers/{org}/{slug}",
			"stigmer://skills/{org}/{slug}",
			"stigmer://skills/{org}/{slug}/{version}",
			"stigmer://workflows/{org}/{slug}",
		},
	)
}

// ServeStdio runs the MCP server over stdin/stdout until the client
// disconnects or the context is cancelled.
//
// In STDIO mode the API key is loaded once from the environment at startup
// (validated during config loading) and injected into the base context.
// Every tool handler can then retrieve it via auth.GetAPIKey(ctx).
func (s *Server) ServeStdio(ctx context.Context) error {
	ctx = auth.WithAPIKey(ctx, s.config.APIKey)
	return s.mcp.Run(ctx, &mcp.StdioTransport{})
}

// version returns the server version. This is set at build time via ldflags
// or falls back to "dev".
func version() string {
	// Can be overridden via:
	//   go build -ldflags "-X github.com/stigmer/stigmer/mcp-server/internal/server.buildVersion=v1.0.0"
	if buildVersion != "" {
		return buildVersion
	}
	return "dev"
}

var buildVersion string

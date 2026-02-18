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
	"github.com/stigmer/stigmer/mcp-server/internal/domains/search"
	"github.com/stigmer/stigmer/mcp-server/internal/domains/skills"
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
	mcp.AddTool(srv, search.Tool(), search.Handler(serverAddress))
	mcp.AddTool(srv, agents.Tool(), agents.Handler(serverAddress))
	mcp.AddTool(srv, skills.Tool(), skills.Handler(serverAddress))
	mcp.AddTool(srv, workflows.Tool(), workflows.Handler(serverAddress))

	slog.Info("tools registered", "count", 4, "tools", []string{"search", "get_agent", "get_skill", "get_workflow"})
}

// registerResources wires up the URI-addressable resource templates. These
// provide a complementary read path to tools: MCP clients that already know a
// resource URI can read it directly without calling a tool.
func registerResources(srv *mcp.Server, serverAddress string) {
	srv.AddResourceTemplate(agents.Template(), agents.ResourceHandler(serverAddress))
	srv.AddResourceTemplate(skills.Template(), skills.ResourceHandler(serverAddress))
	srv.AddResourceTemplate(workflows.Template(), workflows.ResourceHandler(serverAddress))

	slog.Info("resource templates registered", "count", 3,
		"templates", []string{
			"stigmer://agents/{org}/{slug}",
			"stigmer://skills/{org}/{slug}",
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

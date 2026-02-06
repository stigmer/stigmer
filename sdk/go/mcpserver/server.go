package mcpserver

import (
	"errors"
	"sync"

	genMcpServer "github.com/stigmer/stigmer/sdk/go/gen/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

// McpServerArgs is an alias for the generated McpServerArgs from gen/mcpserver.
// This provides a single source of truth for MCP server configuration.
type McpServerArgs = genMcpServer.McpServerArgs

// Context is a minimal interface that represents a stigmer context.
// This allows the mcpserver package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterMCPServer(*MCPServer)
}

// MCPServer represents an MCP server resource in the SDK.
//
// MCPServer uses the COMPOSITION pattern - it embeds Args rather than
// duplicating its fields. This provides a single source of truth for
// configuration and reduces maintenance burden when the generator changes.
//
// The MCPServer is a "template" layer - it defines the configuration and
// requirements for an MCP server. It can be referenced by multiple agents.
//
// Use mcpserver.Stdio() or mcpserver.HTTP() with stigmer.Run() to create an MCPServer:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    server, err := mcpserver.Stdio(ctx, "github-mcp", &mcpserver.McpServerArgs{
//	        Description: "GitHub MCP server for repository operations",
//	        Stdio: &types.StdioServerConfig{
//	            Command: "npx",
//	            Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	        },
//	    })
//	    return err
//	})
type MCPServer struct {
	// Name is the human-readable name for this MCP server.
	// This comes from the constructor, not from Args.
	Name string

	// Slug is the URL-friendly identifier (auto-generated from name).
	// This comes from the constructor, not from Args.
	Slug string

	// Args contains all configuration for this MCP server.
	// This is the SINGLE SOURCE OF TRUTH for configuration.
	// Uses COMPOSITION pattern - we embed the generated Args struct
	// rather than duplicating its fields.
	Args *McpServerArgs

	// ctx is the context that this MCP server is registered with (optional).
	ctx Context

	// mu protects concurrent access to mutable fields.
	mu sync.Mutex
}

// Stdio creates a stdio-based MCP server.
//
// Stdio servers run as subprocesses and communicate via stdin/stdout.
// This is the most common type, used for Node.js, Python, and CLI-based MCP servers.
//
// Required:
//   - name: MCP server name (will be converted to slug)
//   - args.Stdio: Stdio configuration with command and arguments
//
// Example:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/mcpserver"
//	    "github.com/stigmer/stigmer/sdk/go/gen/types"
//	)
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    server, err := mcpserver.Stdio(ctx, "github-mcp", &mcpserver.McpServerArgs{
//	        Description: "GitHub MCP server for repository operations",
//	        Stdio: &types.StdioServerConfig{
//	            Command: "npx",
//	            Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	        },
//	        Tags: []string{"git", "vcs", "code-analysis"},
//	    })
//	    return err
//	})
func Stdio(ctx Context, name string, args *McpServerArgs) (*MCPServer, error) {
	if name == "" {
		return nil, errors.New("mcpserver: name is required")
	}

	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &McpServerArgs{}
	}

	// Validate that Stdio config is provided
	if args.Stdio == nil {
		return nil, errors.New("mcpserver: Stdio configuration is required for Stdio server")
	}

	// Validate command is provided
	if args.Stdio.Command == "" {
		return nil, errors.New("mcpserver: Stdio.Command is required")
	}

	m := &MCPServer{
		Name: name,
		Slug: naming.GenerateSlug(name),
		Args: args, // Compose, don't copy
		ctx:  ctx,
	}

	// Validate slug format
	if err := naming.ValidateSlug(m.Slug); err != nil {
		return nil, err
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterMCPServer(m)
	}

	return m, nil
}

// HTTP creates an HTTP-based MCP server.
//
// HTTP servers communicate via HTTP + Server-Sent Events.
// This is used for remote/managed MCP services accessible over the network.
//
// Required:
//   - name: MCP server name (will be converted to slug)
//   - args.Http: HTTP configuration with URL
//
// Example:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/mcpserver"
//	    "github.com/stigmer/stigmer/sdk/go/gen/types"
//	)
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    server, err := mcpserver.HTTP(ctx, "external-api", &mcpserver.McpServerArgs{
//	        Description: "External API MCP server",
//	        Http: &types.HttpServerConfig{
//	            Url: "https://mcp.example.com/v1",
//	            Headers: map[string]string{
//	                "Authorization": "Bearer ${API_TOKEN}",
//	            },
//	        },
//	    })
//	    return err
//	})
func HTTP(ctx Context, name string, args *McpServerArgs) (*MCPServer, error) {
	if name == "" {
		return nil, errors.New("mcpserver: name is required")
	}

	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &McpServerArgs{}
	}

	// Validate that HTTP config is provided
	if args.Http == nil {
		return nil, errors.New("mcpserver: Http configuration is required for HTTP server")
	}

	// Validate URL is provided
	if args.Http.Url == "" {
		return nil, errors.New("mcpserver: Http.Url is required")
	}

	m := &MCPServer{
		Name: name,
		Slug: naming.GenerateSlug(name),
		Args: args, // Compose, don't copy
		ctx:  ctx,
	}

	// Validate slug format
	if err := naming.ValidateSlug(m.Slug); err != nil {
		return nil, err
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterMCPServer(m)
	}

	return m, nil
}

// String returns a string representation of the MCPServer.
func (m *MCPServer) String() string {
	serverType := "unknown"
	if m.Args != nil {
		if m.Args.Stdio != nil {
			serverType = "stdio"
		} else if m.Args.Http != nil {
			serverType = "http"
		} else if m.Args.Docker != nil {
			serverType = "docker"
		}
	}
	return "MCPServer(name=" + m.Name + ", type=" + serverType + ")"
}

// ServerType returns the type of this MCP server ("stdio", "http", "docker", or "unknown").
func (m *MCPServer) ServerType() string {
	if m.Args == nil {
		return "unknown"
	}
	if m.Args.Stdio != nil {
		return "stdio"
	}
	if m.Args.Http != nil {
		return "http"
	}
	if m.Args.Docker != nil {
		return "docker"
	}
	return "unknown"
}

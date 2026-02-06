package mcpserver

import (
	"sync"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"

	genMcpServer "github.com/stigmer/stigmer/sdk/go/gen/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/context/naming"
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

	// Org is the organization that owns this MCP server (optional).
	// This is metadata, not part of Args.
	Org string

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
		return nil, ErrNameRequired
	}

	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &McpServerArgs{}
	}

	// Validate that Stdio config is provided
	if args.Stdio == nil {
		return nil, ErrStdioRequired
	}

	// Validate command is provided
	if args.Stdio.Command == "" {
		return nil, ErrCommandRequired
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
		return nil, ErrNameRequired
	}

	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &McpServerArgs{}
	}

	// Validate that HTTP config is provided
	if args.Http == nil {
		return nil, ErrHttpRequired
	}

	// Validate URL is provided
	if args.Http.Url == "" {
		return nil, ErrUrlRequired
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
		}
	}
	return "MCPServer(name=" + m.Name + ", type=" + serverType + ")"
}

// ServerType returns the type of this MCP server ("stdio", "http", or "unknown").
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
	return "unknown"
}

// ============================================================================
// Builder Methods - Modify Args (single source of truth)
// ============================================================================

// SetDescription sets the MCP server description.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.SetDescription("GitHub MCP server for repository operations")
func (m *MCPServer) SetDescription(description string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.Description = description
	return m
}

// SetIconUrl sets the MCP server icon URL.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.SetIconUrl("https://github.githubassets.com/favicons/favicon.svg")
func (m *MCPServer) SetIconUrl(url string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.IconUrl = url
	return m
}

// AddTag adds a categorization tag for marketplace discoverability.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.AddTag("git").AddTag("vcs").AddTag("code-analysis")
func (m *MCPServer) AddTag(tag string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.Tags = append(m.Args.Tags, tag)
	return m
}

// AddTags adds multiple categorization tags for marketplace discoverability.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.AddTags("git", "vcs", "code-analysis")
func (m *MCPServer) AddTags(tags ...string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.Tags = append(m.Args.Tags, tags...)
	return m
}

// EnableTool adds a tool to the default enabled tools list.
// Tools must match exactly what the MCP server reports via tools/list.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.EnableTool("create_pull_request").EnableTool("search_code")
func (m *MCPServer) EnableTool(tool string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.DefaultEnabledTools = append(m.Args.DefaultEnabledTools, tool)
	return m
}

// EnableTools adds multiple tools to the default enabled tools list.
// Tools must match exactly what the MCP server reports via tools/list.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.EnableTools("create_pull_request", "search_code", "get_file_contents")
func (m *MCPServer) EnableTools(tools ...string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	m.Args.DefaultEnabledTools = append(m.Args.DefaultEnabledTools, tools...)
	return m
}

// RequireApproval adds a default tool approval policy for a specific tool.
// Tools with approval policies require user approval before execution.
// This method is thread-safe and can be called concurrently.
//
// The message supports {{args.field}} placeholders for dynamic content.
// If message is empty, a default message is generated: "Execute tool: {tool_name}"
//
// Example:
//
//	server.RequireApproval("delete_repository", "Delete repository: {{args.repo}}")
//	server.RequireApproval("force_push", "Force push to {{args.branch}}")
func (m *MCPServer) RequireApproval(toolName, message string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	policy := &mcpserverv1.ToolApprovalPolicy{
		ToolName: toolName,
		Message:  message,
	}
	m.Args.DefaultToolApprovals = append(m.Args.DefaultToolApprovals, policy)
	return m
}

// ============================================================================
// Environment Variable Declaration Methods
// ============================================================================

// RequireSecret declares that this MCP server requires a secret environment variable.
// This adds to Args.EnvSpec with is_secret=true and empty value (must be provided at runtime).
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.RequireSecret("GITHUB_TOKEN", "GitHub personal access token with repo scope")
//	server.RequireSecret("AWS_SECRET_KEY", "AWS secret access key for S3 operations")
func (m *MCPServer) RequireSecret(name, description string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureEnvSpec()
	m.Args.EnvSpec.Data[name] = &environmentv1.EnvironmentValue{
		Value:       "", // Empty = must be provided at instance time
		IsSecret:    true,
		Description: description,
	}
	return m
}

// RequireConfig declares that this MCP server requires a configuration environment variable (non-secret).
// This adds to Args.EnvSpec with is_secret=false.
//
// If defaultValue is non-empty, it will be used when the variable is not provided.
// If defaultValue is empty, the variable is required at runtime.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	server.RequireConfig("GITHUB_OWNER", "stigmer", "Default GitHub organization or user")
//	server.RequireConfig("LOG_LEVEL", "info", "Logging verbosity (debug, info, warn, error)")
//	server.RequireConfig("API_BASE_URL", "", "API base URL (required)")
func (m *MCPServer) RequireConfig(name, defaultValue, description string) *MCPServer {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureEnvSpec()
	m.Args.EnvSpec.Data[name] = &environmentv1.EnvironmentValue{
		Value:       defaultValue,
		IsSecret:    false,
		Description: description,
	}
	return m
}

// ensureEnvSpec ensures Args and Args.EnvSpec are initialized.
// Must be called with m.mu held.
func (m *MCPServer) ensureEnvSpec() {
	if m.Args == nil {
		m.Args = &McpServerArgs{}
	}
	if m.Args.EnvSpec == nil {
		m.Args.EnvSpec = &environmentv1.EnvironmentSpec{
			Data: make(map[string]*environmentv1.EnvironmentValue),
		}
	}
	if m.Args.EnvSpec.Data == nil {
		m.Args.EnvSpec.Data = make(map[string]*environmentv1.EnvironmentValue)
	}
}

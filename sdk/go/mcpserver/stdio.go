package mcpserver

import (
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// StdioArgs is an alias for the generated StdioServer type from codegen.
// This follows the pattern of using generated types for Args structs.
type StdioArgs = types.StdioServer

// StdioServer represents a stdio-based MCP server that runs as a subprocess.
// Communication happens via stdin/stdout (most common MCP server type).
//
// Example:
//
//	server, _ := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
//	    Command: "npx",
//	    Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	    EnvPlaceholders: map[string]string{
//	        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
//	    },
//	})
type StdioServer struct {
	baseServer
	command         string
	args            []string
	envPlaceholders map[string]string
	workingDir      string
}

// Stdio creates a new stdio-based MCP server with struct-based args (Pulumi pattern).
//
// The args struct uses the generated types.StdioServer from proto definitions.
// This ensures the Args always match the proto schema.
//
// Follows Pulumi's Args pattern: context, name as parameters, struct args for configuration.
//
// Required:
//   - ctx: stigmer context (for consistency with other resources)
//   - name: server name (e.g., "github", "aws")
//   - args.Command: command to execute
//
// Optional args fields (from generated types.StdioServer):
//   - Args: command arguments
//   - EnvPlaceholders: environment variable placeholders
//   - WorkingDir: working directory for the process
//
// Note: EnabledTools is set separately via the EnableTools() builder method,
// as it's defined on McpServerDefinition in proto, not on StdioServer.
//
// Example:
//
//	github, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
//	    Command: "npx",
//	    Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	    EnvPlaceholders: map[string]string{
//	        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
//	    },
//	})
//	github.EnableTools("create_issue", "list_repos")  // Set enabled tools
//
// Example with nil args (validation will fail without command):
//
//	server, err := mcpserver.Stdio(ctx, "custom", nil)
//	// Returns error: command is required
func Stdio(ctx Context, name string, args *StdioArgs) (*StdioServer, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &StdioArgs{}
	}

	// Initialize env placeholders map
	envPlaceholders := args.EnvPlaceholders
	if envPlaceholders == nil {
		envPlaceholders = make(map[string]string)
	}

	server := &StdioServer{
		baseServer: baseServer{
			name: name,
		},
		command:         args.Command,
		args:            args.Args,
		envPlaceholders: envPlaceholders,
		workingDir:      args.WorkingDir,
	}

	if err := server.Validate(); err != nil {
		return nil, err
	}

	return server, nil
}

// EnableTools sets the enabled tools for this server (builder pattern).
// If not called or called with empty slice, all tools are enabled.
func (s *StdioServer) EnableTools(tools ...string) *StdioServer {
	s.enabledTools = tools
	return s
}

// Command returns the command to execute.
func (s *StdioServer) Command() string {
	return s.command
}

// Args returns the command arguments.
func (s *StdioServer) Args() []string {
	return s.args
}

// EnvPlaceholders returns the environment variable placeholders.
func (s *StdioServer) EnvPlaceholders() map[string]string {
	return s.envPlaceholders
}

// WorkingDir returns the working directory for the process.
func (s *StdioServer) WorkingDir() string {
	return s.workingDir
}

// Type returns the server type (stdio).
func (s *StdioServer) Type() ServerType {
	return TypeStdio
}

// Validate checks if the stdio server configuration is valid.
func (s *StdioServer) Validate() error {
	if s.name == "" {
		return fmt.Errorf("stdio server: name is required")
	}
	if s.command == "" {
		return fmt.Errorf("stdio server %q: command is required", s.name)
	}
	return nil
}

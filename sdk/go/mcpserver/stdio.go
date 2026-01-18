package mcpserver

import (
	"fmt"
)

// StdioServer represents a stdio-based MCP server that runs as a subprocess.
// Communication happens via stdin/stdout (most common MCP server type).
//
// Example:
//
//	server := mcpserver.Stdio(
//		mcpserver.WithName("github"),
//		mcpserver.WithCommand("npx"),
//		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
//	)
type StdioServer struct {
	baseServer
	command         string
	args            []string
	envPlaceholders map[string]string
	workingDir      string
}

// Stdio creates a new stdio-based MCP server with the given options.
//
// Example:
//
//	github := mcpserver.Stdio(
//		mcpserver.WithName("github"),
//		mcpserver.WithCommand("npx"),
//		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
//		mcpserver.WithWorkingDir("/app"),
//		mcpserver.WithEnabledTools("create_issue", "list_repos"),
//	)
func Stdio(opts ...Option) (*StdioServer, error) {
	server := &StdioServer{
		envPlaceholders: make(map[string]string),
	}

	for _, opt := range opts {
		if err := opt(server); err != nil {
			return nil, fmt.Errorf("stdio server option: %w", err)
		}
	}

	if err := server.Validate(); err != nil {
		return nil, err
	}

	return server, nil
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

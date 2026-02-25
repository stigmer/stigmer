package mcpserver

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// createTransport builds an MCP transport from the server's spec.
// For stdio servers, it creates a CommandTransport that spawns the server as a subprocess.
// For HTTP servers, it creates a StreamableClientTransport that connects to the remote endpoint.
func createTransport(spec *mcpserverv1.McpServerSpec) (mcp.Transport, error) {
	if stdio := spec.GetStdio(); stdio != nil {
		return createStdioTransport(stdio)
	}
	if httpCfg := spec.GetHttp(); httpCfg != nil {
		return createHTTPTransport(httpCfg)
	}
	return nil, fmt.Errorf("MCP server has no transport configured (expected stdio or http)")
}

// createStdioTransport builds a CommandTransport that spawns the MCP server process.
// Environment variables are inherited from the current process so that credentials
// (e.g., GITHUB_TOKEN, API keys) configured in the developer's shell are available
// to the MCP server without ever leaving the local machine.
func createStdioTransport(cfg *mcpserverv1.StdioServerConfig) (*mcp.CommandTransport, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("stdio transport requires a command")
	}

	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Env = os.Environ()
	cmd.Stderr = os.Stderr

	if cfg.WorkingDir != "" {
		cmd.Dir = cfg.WorkingDir
	}

	return &mcp.CommandTransport{Command: cmd}, nil
}

// createHTTPTransport builds a StreamableClientTransport for HTTP-based MCP servers.
// Headers from the server config are attached to every request via a custom RoundTripper.
func createHTTPTransport(cfg *mcpserverv1.HttpServerConfig) (*mcp.StreamableClientTransport, error) {
	if cfg.Url == "" {
		return nil, fmt.Errorf("HTTP transport requires a URL")
	}

	transport := &mcp.StreamableClientTransport{
		Endpoint:            cfg.Url,
		DisableStandaloneSSE: true,
	}

	if len(cfg.Headers) > 0 {
		transport.HTTPClient = &http.Client{
			Transport: &headerRoundTripper{
				base:    http.DefaultTransport,
				headers: cfg.Headers,
			},
		}
	}

	return transport, nil
}

// headerRoundTripper injects static headers into every HTTP request.
type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (rt *headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	for k, v := range rt.headers {
		req.Header.Set(k, v)
	}
	return rt.base.RoundTrip(req)
}

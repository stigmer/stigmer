// Package mcpdiscovery provides shared MCP server capability discovery logic.
//
// This package handles the MCP protocol interaction for discovering tools and
// resource templates from MCP servers. It is used by both the CLI discover
// command and the bootstrap auto-discovery flow.
package mcpdiscovery

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
)

// CreateTransport builds an MCP transport from the server's spec.
//
// For stdio servers it creates a CommandTransport that spawns the server as a
// subprocess. For HTTP servers it creates a StreamableClientTransport.
//
// envOverrides supplies additional KEY=VALUE pairs that are merged on top of
// os.Environ() for stdio transports. An override whose key already exists in
// os.Environ() replaces the inherited value. This mechanism lets callers
// inject credentials (e.g. STIGMER_SERVER_ADDRESS) that aren't set in the
// current process environment.
//
// stderr receives the subprocess's stderr output (stdio transports only).
// Pass nil to discard stderr. Callers typically use a *bytes.Buffer so they
// can include the subprocess output in error messages without cluttering the
// user's terminal.
func CreateTransport(spec *mcpserverv1.McpServerSpec, envOverrides []string, stderr io.Writer) (mcp.Transport, error) {
	if stdio := spec.GetStdio(); stdio != nil {
		return createStdioTransport(stdio, envOverrides, stderr)
	}
	if httpCfg := spec.GetHttp(); httpCfg != nil {
		return createHTTPTransport(httpCfg)
	}
	return nil, fmt.Errorf("MCP server has no transport configured (expected stdio or http)")
}

// createStdioTransport builds a CommandTransport that spawns the MCP server
// process. The subprocess inherits os.Environ() merged with envOverrides so
// that credentials configured in the caller's environment or resolved at
// runtime are available without ever leaving the local machine.
func createStdioTransport(cfg *mcpserverv1.StdioServerConfig, envOverrides []string, stderr io.Writer) (*mcp.CommandTransport, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("stdio transport requires a command")
	}

	if goEnv := goRunEnvOverrides(cfg); len(goEnv) > 0 {
		envOverrides = append(envOverrides, goEnv...)
	}

	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Env = mergeEnv(os.Environ(), envOverrides)

	if stderr != nil {
		cmd.Stderr = stderr
	} else {
		cmd.Stderr = io.Discard
	}

	if cfg.WorkingDir != "" {
		cmd.Dir = cfg.WorkingDir
	}

	return &mcp.CommandTransport{Command: cmd}, nil
}

// goRunEnvOverrides returns Go-toolchain environment overrides needed when the
// stdio command is "go run <module>@<version>". Specifically, it sets
// GONOSUMDB for the module's domain so that newly tagged versions are usable
// immediately, without waiting for sum.golang.org to index the tag.
//
// This is safe because the MCP server binary being run is specified by the
// platform operator (seedpack YAML or user config), not by untrusted input.
func goRunEnvOverrides(cfg *mcpserverv1.StdioServerConfig) []string {
	if cfg.Command != "go" {
		return nil
	}
	if len(cfg.Args) < 2 || cfg.Args[0] != "run" {
		return nil
	}

	pkg := cfg.Args[1]
	if i := strings.IndexByte(pkg, '@'); i > 0 {
		pkg = pkg[:i]
	}

	prefix := modulePrefix(pkg)
	if prefix == "" {
		return nil
	}

	return []string{
		fmt.Sprintf("GONOSUMDB=%s", prefix),
		fmt.Sprintf("GONOSUMCHECK=%s", prefix),
	}
}

// modulePrefix extracts a "host/org/repo/*" prefix from a Go package path.
// For "github.com/stigmer/stigmer/sdk/go/..." it returns
// "github.com/stigmer/stigmer/*".
func modulePrefix(pkg string) string {
	parts := strings.SplitN(pkg, "/", 4)
	if len(parts) < 3 {
		return ""
	}
	return parts[0] + "/" + parts[1] + "/" + parts[2] + "/*"
}

// createHTTPTransport builds a StreamableClientTransport for HTTP-based MCP
// servers. Headers from the server config are attached to every request via a
// custom RoundTripper.
func createHTTPTransport(cfg *mcpserverv1.HttpServerConfig) (*mcp.StreamableClientTransport, error) {
	if cfg.Url == "" {
		return nil, fmt.Errorf("HTTP transport requires a URL")
	}

	transport := &mcp.StreamableClientTransport{
		Endpoint:             cfg.Url,
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

// mergeEnv combines base environment variables with overrides. If an override
// key already exists in base, the override value wins.
func mergeEnv(base, overrides []string) []string {
	if len(overrides) == 0 {
		return base
	}

	idx := make(map[string]int, len(base))
	for i, entry := range base {
		if k := envKey(entry); k != "" {
			idx[k] = i
		}
	}

	merged := make([]string, len(base))
	copy(merged, base)

	for _, entry := range overrides {
		k := envKey(entry)
		if k == "" {
			continue
		}
		if i, ok := idx[k]; ok {
			merged[i] = entry
		} else {
			merged = append(merged, entry)
			idx[k] = len(merged) - 1
		}
	}

	return merged
}

// envKey extracts the key portion of a KEY=VALUE environment entry.
func envKey(entry string) string {
	for i := range entry {
		if entry[i] == '=' {
			return entry[:i]
		}
	}
	return ""
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

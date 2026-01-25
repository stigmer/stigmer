package mcpserver

import (
	"fmt"
	"net/url"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// HTTPArgs is an alias for the generated HttpServer type from codegen.
// This follows the pattern of using generated types for Args structs.
type HTTPArgs = types.HttpServer

// HTTPServer represents an HTTP-based MCP server that communicates via HTTP + SSE.
// Used for remote or managed MCP services.
//
// Example:
//
//	server, _ := mcpserver.HTTP(ctx, "api-service", &mcpserver.HTTPArgs{
//	    Url: "https://mcp.example.com",
//	    Headers: map[string]string{
//	        "Authorization": "Bearer ${API_TOKEN}",
//	    },
//	    TimeoutSeconds: 60,
//	})
type HTTPServer struct {
	baseServer
	url            string
	headers        map[string]string
	queryParams    map[string]string
	timeoutSeconds int32
}

// HTTP creates a new HTTP-based MCP server with struct-based args (Pulumi pattern).
//
// The args struct uses the generated types.HttpServer from proto definitions.
// This ensures the Args always match the proto schema.
//
// Follows Pulumi's Args pattern: context, name as parameters, struct args for configuration.
//
// Required:
//   - ctx: stigmer context (for consistency with other resources)
//   - name: server name (e.g., "api-service")
//   - args.Url: base URL of the MCP server
//
// Optional args fields (from generated types.HttpServer):
//   - Headers: HTTP headers (can contain placeholders)
//   - QueryParams: query parameters (can contain placeholders)
//   - TimeoutSeconds: HTTP timeout (defaults to 30)
//
// Note: EnabledTools is set separately via the EnableTools() builder method,
// as it's defined on McpServerDefinition in proto, not on HttpServer.
//
// Example:
//
//	api, err := mcpserver.HTTP(ctx, "api-service", &mcpserver.HTTPArgs{
//	    Url: "https://mcp.example.com",
//	    Headers: map[string]string{
//	        "Authorization": "Bearer ${API_TOKEN}",
//	    },
//	    QueryParams: map[string]string{
//	        "region": "${AWS_REGION}",
//	    },
//	    TimeoutSeconds: 60,
//	})
//	api.EnableTools("search", "fetch")  // Set enabled tools
func HTTP(ctx Context, name string, args *HTTPArgs) (*HTTPServer, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &HTTPArgs{}
	}

	// Initialize maps
	headers := args.Headers
	if headers == nil {
		headers = make(map[string]string)
	}
	queryParams := args.QueryParams
	if queryParams == nil {
		queryParams = make(map[string]string)
	}

	// Default timeout
	timeout := args.TimeoutSeconds
	if timeout == 0 {
		timeout = 30
	}

	server := &HTTPServer{
		baseServer: baseServer{
			name: name,
		},
		url:            args.Url,
		headers:        headers,
		queryParams:    queryParams,
		timeoutSeconds: timeout,
	}

	if err := server.Validate(); err != nil {
		return nil, err
	}

	return server, nil
}

// EnableTools sets the enabled tools for this server (builder pattern).
// If not called or called with empty slice, all tools are enabled.
func (h *HTTPServer) EnableTools(tools ...string) *HTTPServer {
	h.enabledTools = tools
	return h
}

// URL returns the base URL of the MCP server.
func (h *HTTPServer) URL() string {
	return h.url
}

// Headers returns the HTTP headers.
func (h *HTTPServer) Headers() map[string]string {
	return h.headers
}

// QueryParams returns the query parameters.
func (h *HTTPServer) QueryParams() map[string]string {
	return h.queryParams
}

// TimeoutSeconds returns the HTTP timeout in seconds.
func (h *HTTPServer) TimeoutSeconds() int32 {
	return h.timeoutSeconds
}

// Type returns the server type (http).
func (h *HTTPServer) Type() ServerType {
	return TypeHTTP
}

// Validate checks if the HTTP server configuration is valid.
func (h *HTTPServer) Validate() error {
	if h.name == "" {
		return fmt.Errorf("http server: name is required")
	}
	if h.url == "" {
		return fmt.Errorf("http server %q: url is required", h.name)
	}

	// Validate URL format
	parsedURL, err := url.Parse(h.url)
	if err != nil {
		return fmt.Errorf("http server %q: invalid url %q: %w", h.name, h.url, err)
	}

	// Ensure URL has a scheme (http or https)
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("http server %q: url must have http or https scheme, got %q", h.name, h.url)
	}

	if h.timeoutSeconds < 0 {
		return fmt.Errorf("http server %q: timeout_seconds cannot be negative", h.name)
	}

	return nil
}

package mcpserver

import (
	"fmt"
	"net/url"
)

// HTTPServer represents an HTTP-based MCP server that communicates via HTTP + SSE.
// Used for remote or managed MCP services.
//
// Example:
//
//	server := mcpserver.HTTP(
//		mcpserver.WithName("api-service"),
//		mcpserver.WithURL("https://mcp.example.com"),
//		mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
//		mcpserver.WithTimeout(60),
//	)
type HTTPServer struct {
	baseServer
	url            string
	headers        map[string]string
	queryParams    map[string]string
	timeoutSeconds int32
}

// HTTP creates a new HTTP-based MCP server with the given options.
//
// Example:
//
//	api := mcpserver.HTTP(
//		mcpserver.WithName("api-service"),
//		mcpserver.WithURL("https://mcp.example.com"),
//		mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
//		mcpserver.WithQueryParam("region", "${AWS_REGION}"),
//		mcpserver.WithTimeout(60),
//		mcpserver.WithEnabledTools("search", "fetch"),
//	)
func HTTP(opts ...Option) (*HTTPServer, error) {
	server := &HTTPServer{
		headers:        make(map[string]string),
		queryParams:    make(map[string]string),
		timeoutSeconds: 30, // default timeout
	}

	for _, opt := range opts {
		if err := opt(server); err != nil {
			return nil, fmt.Errorf("http server option: %w", err)
		}
	}

	if err := server.Validate(); err != nil {
		return nil, err
	}

	return server, nil
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

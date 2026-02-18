// Package config provides environment-variable-based configuration for mcp-server-stigmer.
//
// Every configurable value is read from an environment variable with a
// STIGMER_ prefix. Reasonable defaults are provided for development use.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Transport enumerates the supported communication modes between MCP clients
// and the MCP server.
type Transport string

const (
	// TransportStdio communicates over stdin/stdout. This is the primary mode
	// for local development: the MCP client (Cursor, Claude Desktop, etc.)
	// spawns the server as a child process.
	TransportStdio Transport = "stdio"

	// TransportHTTP serves MCP over Streamable HTTP. This is the mode for
	// remote / shared deployments where multiple users connect over the
	// network. Each request carries its own Bearer token.
	TransportHTTP Transport = "http"

	// TransportBoth runs STDIO and HTTP simultaneously. Useful for
	// development environments where you want both local and remote access.
	TransportBoth Transport = "both"
)

// Config holds all runtime configuration.
type Config struct {
	// StigmerServerAddress is the gRPC dial target for stigmer-server
	// (e.g. "localhost:9090" or "api.stigmer.ai:443").
	StigmerServerAddress string

	// APIKey authenticates the MCP server's calls to stigmer-server.
	// In STDIO mode this is loaded once from the environment at startup.
	// In HTTP mode every inbound request carries its own key via the
	// Authorization header, so this field is only used for STDIO.
	APIKey string

	// Transport selects the communication mode: stdio, http, or both.
	Transport Transport

	// HTTPPort is the TCP port the HTTP transport listens on.
	HTTPPort string

	// HTTPAuthEnabled controls whether HTTP requests require a valid
	// Authorization: Bearer token. Defaults to true.
	HTTPAuthEnabled bool
}

// LoadFromEnv reads configuration from the process environment.
//
// Environment variables:
//
//	STIGMER_SERVER_ADDRESS   – gRPC address (default "localhost:9090")
//	STIGMER_API_KEY          – API key (required when transport is stdio or both)
//	STIGMER_MCP_TRANSPORT    – "stdio" | "http" | "both" (default "stdio")
//	STIGMER_MCP_HTTP_PORT    – HTTP listen port (default "8080")
//	STIGMER_MCP_HTTP_AUTH_ENABLED – "true" | "false" (default "true")
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		StigmerServerAddress: envOr("STIGMER_SERVER_ADDRESS", "localhost:9090"),
		APIKey:               os.Getenv("STIGMER_API_KEY"),
		Transport:            Transport(strings.ToLower(envOr("STIGMER_MCP_TRANSPORT", "stdio"))),
		HTTPPort:             envOr("STIGMER_MCP_HTTP_PORT", "8080"),
		HTTPAuthEnabled:      envOr("STIGMER_MCP_HTTP_AUTH_ENABLED", "true") == "true",
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// validate checks invariants that should hold before the server starts.
func (c *Config) validate() error {
	switch c.Transport {
	case TransportStdio, TransportHTTP, TransportBoth:
		// valid
	default:
		return fmt.Errorf("invalid STIGMER_MCP_TRANSPORT %q: must be stdio, http, or both", c.Transport)
	}

	if c.StigmerServerAddress == "" {
		return fmt.Errorf("STIGMER_SERVER_ADDRESS must not be empty")
	}

	// STDIO (or dual) mode needs an API key up front; HTTP mode receives
	// per-request keys via the Authorization header.
	if (c.Transport == TransportStdio || c.Transport == TransportBoth) && c.APIKey == "" {
		return fmt.Errorf("STIGMER_API_KEY is required when transport is %q", c.Transport)
	}

	return nil
}

// envOr returns the value of the given environment variable, or fallback if
// the variable is unset or empty.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

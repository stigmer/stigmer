// Package config provides environment-variable-based configuration for mcp-server-stigmer.
//
// Every configurable value is read from an environment variable with a
// STIGMER_ prefix. Reasonable defaults are provided for development use.
package config

import (
	"fmt"
	"log/slog"
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

// LogFormat selects the structured log output encoding.
type LogFormat string

const (
	LogFormatText LogFormat = "text"
	LogFormatJSON LogFormat = "json"
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

	// LogFormat controls the structured log encoding: "text" or "json".
	LogFormat LogFormat

	// LogLevel controls the minimum severity for emitted log records.
	LogLevel slog.Level
}

// LoadFromEnv reads configuration from the process environment.
//
// Environment variables:
//
//	STIGMER_SERVER_ADDRESS        – gRPC address (default "localhost:9090")
//	STIGMER_API_KEY               – API key (required when transport is stdio or both)
//	STIGMER_MCP_TRANSPORT         – "stdio" | "http" | "both" (default "stdio")
//	STIGMER_MCP_HTTP_PORT         – HTTP listen port (default "8080")
//	STIGMER_MCP_HTTP_AUTH_ENABLED – "true" | "false" (default "true")
//	STIGMER_MCP_LOG_FORMAT        – "text" | "json" (default "text")
//	STIGMER_MCP_LOG_LEVEL         – "debug" | "info" | "warn" | "error" (default "info")
func LoadFromEnv() (*Config, error) {
	logLevel, err := ParseLogLevel(envOr("STIGMER_MCP_LOG_LEVEL", "info"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		StigmerServerAddress: envOr("STIGMER_SERVER_ADDRESS", "localhost:9090"),
		APIKey:               os.Getenv("STIGMER_API_KEY"),
		Transport:            Transport(strings.ToLower(envOr("STIGMER_MCP_TRANSPORT", "stdio"))),
		HTTPPort:             envOr("STIGMER_MCP_HTTP_PORT", "8080"),
		HTTPAuthEnabled:      envOr("STIGMER_MCP_HTTP_AUTH_ENABLED", "true") == "true",
		LogFormat:            LogFormat(strings.ToLower(envOr("STIGMER_MCP_LOG_FORMAT", "text"))),
		LogLevel:             logLevel,
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate checks invariants that should hold before the server starts.
func (c *Config) Validate() error {
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

	switch c.LogFormat {
	case LogFormatText, LogFormatJSON:
		// valid
	default:
		return fmt.Errorf("invalid STIGMER_MCP_LOG_FORMAT %q: must be text or json", c.LogFormat)
	}

	return nil
}

// ParseLogLevel converts a human-friendly level name to slog.Level.
func ParseLogLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("invalid STIGMER_MCP_LOG_LEVEL %q: must be debug, info, warn, or error", s)
	}
}

// envOr returns the value of the given environment variable, or fallback if
// the variable is unset or empty.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

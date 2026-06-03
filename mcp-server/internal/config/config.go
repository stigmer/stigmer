// Package config provides environment-variable-based configuration for mcp-server-stigmer.
//
// Every configurable value is read from an environment variable with a
// STIGMER_ prefix. Reasonable defaults are provided for development use.
package config

import (
	"fmt"
	"log/slog"
	"net"
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
	// (e.g. "localhost:7234" or "api.stigmer.ai:443").
	StigmerServerAddress string

	// APIKey optionally authenticates the MCP server's calls to stigmer-server.
	// In STDIO mode this is loaded once from the environment at startup.
	// In HTTP mode every inbound request carries its own key via the
	// Authorization header, so this field is only used for STDIO.
	// When targeting an unauthenticated backend (e.g. the local daemon),
	// this may be empty.
	APIKey string

	// Transport selects the communication mode: stdio, http, or both.
	Transport Transport

	// HTTPPort is the TCP port the HTTP transport listens on.
	HTTPPort string

	// HTTPAuthEnabled controls whether HTTP requests require a valid
	// Authorization: Bearer token. Defaults to true.
	HTTPAuthEnabled bool

	// OAuth holds optional OAuth 2.0 Protected Resource Metadata (RFC 9728)
	// configuration. It is disabled by default and supplied by the deployment
	// (the cloud prod overlay points it at the Stigmer Auth0 tenant).
	OAuth OAuthMetadata

	// LogFormat controls the structured log encoding: "text" or "json".
	LogFormat LogFormat

	// LogLevel controls the minimum severity for emitted log records.
	LogLevel slog.Level
}

// OAuthMetadata configures the OAuth 2.0 Protected Resource Metadata (RFC 9728)
// that the HTTP transport advertises so that OAuth-capable MCP clients (e.g.
// Claude Desktop's connector GUI) can discover an authorization server without
// a manually-supplied header.
//
// This is purely additive discovery: the MCP server remains a stateless Bearer
// passthrough that never validates tokens or assumes any particular identity
// provider. Clients that supply a Bearer header directly never trigger the
// challenge or read this metadata. The issuer values live in deployment
// configuration, not in code, so the OSS server stays issuer-agnostic.
type OAuthMetadata struct {
	// Enabled turns on RFC 9728 discovery: a metadata document at
	// /.well-known/oauth-protected-resource and a WWW-Authenticate challenge
	// on unauthenticated requests. Defaults to false.
	Enabled bool

	// Resource is the canonical resource identifier for this MCP server
	// (e.g. "https://mcp.stigmer.ai"). Required when Enabled is true.
	Resource string

	// AuthorizationServers is the list of OAuth authorization server issuer
	// identifiers (RFC 8414) that clients may use to obtain a token. At least
	// one is required when Enabled is true.
	AuthorizationServers []string

	// ScopesSupported optionally advertises the scope values clients may
	// request. May be empty.
	ScopesSupported []string
}

// LoadFromEnv reads configuration from the process environment.
//
// Environment variables:
//
//	STIGMER_SERVER_ADDRESS        – gRPC address (default "localhost:7234")
//	STIGMER_API_KEY               – API key (optional; required only for authenticated backends)
//	STIGMER_MCP_TRANSPORT         – "stdio" | "http" | "both" (default "stdio")
//	STIGMER_MCP_HTTP_PORT         – HTTP listen port (default "8080")
//	STIGMER_MCP_HTTP_AUTH_ENABLED – "true" | "false" (default "true")
//	STIGMER_MCP_OAUTH_ENABLED     – "true" | "false" (default "false")
//	STIGMER_MCP_OAUTH_RESOURCE    – canonical resource URI (e.g. "https://mcp.stigmer.ai")
//	STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS – comma-separated issuer URLs
//	STIGMER_MCP_OAUTH_SCOPES_SUPPORTED      – comma-separated scope values (optional)
//	STIGMER_MCP_LOG_FORMAT        – "text" | "json" (default "text")
//	STIGMER_MCP_LOG_LEVEL         – "debug" | "info" | "warn" | "error" (default "info")
func LoadFromEnv() (*Config, error) {
	logLevel, err := ParseLogLevel(envOr("STIGMER_MCP_LOG_LEVEL", "info"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		StigmerServerAddress: envOr("STIGMER_SERVER_ADDRESS", "localhost:7234"),
		APIKey:               os.Getenv("STIGMER_API_KEY"),
		Transport:            Transport(strings.ToLower(envOr("STIGMER_MCP_TRANSPORT", "stdio"))),
		HTTPPort:             envOr("STIGMER_MCP_HTTP_PORT", "8080"),
		HTTPAuthEnabled:      envOr("STIGMER_MCP_HTTP_AUTH_ENABLED", "true") == "true",
		OAuth: OAuthMetadata{
			Enabled:              os.Getenv("STIGMER_MCP_OAUTH_ENABLED") == "true",
			Resource:             strings.TrimSpace(os.Getenv("STIGMER_MCP_OAUTH_RESOURCE")),
			AuthorizationServers: splitList(os.Getenv("STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS")),
			ScopesSupported:      splitList(os.Getenv("STIGMER_MCP_OAUTH_SCOPES_SUPPORTED")),
		},
		LogFormat: LogFormat(strings.ToLower(envOr("STIGMER_MCP_LOG_FORMAT", "text"))),
		LogLevel:  logLevel,
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

	if strings.Contains(c.StigmerServerAddress, "://") {
		slog.Warn("STIGMER_SERVER_ADDRESS contains a URL scheme; "+
			"gRPC targets should be host:port — the scheme will be stripped at dial time",
			"value", c.StigmerServerAddress,
		)
	} else if _, _, err := net.SplitHostPort(c.StigmerServerAddress); err != nil {
		slog.Warn("STIGMER_SERVER_ADDRESS has no explicit port; "+
			":443 with TLS will be assumed for non-loopback addresses",
			"value", c.StigmerServerAddress,
		)
	}

	switch c.LogFormat {
	case LogFormatText, LogFormatJSON:
		// valid
	default:
		return fmt.Errorf("invalid STIGMER_MCP_LOG_FORMAT %q: must be text or json", c.LogFormat)
	}

	if c.OAuth.Enabled {
		if c.OAuth.Resource == "" {
			return fmt.Errorf("STIGMER_MCP_OAUTH_RESOURCE must be set when STIGMER_MCP_OAUTH_ENABLED is true")
		}
		if len(c.OAuth.AuthorizationServers) == 0 {
			return fmt.Errorf("STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS must list at least one issuer when STIGMER_MCP_OAUTH_ENABLED is true")
		}
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

// splitList parses a comma-separated environment value into a slice of trimmed,
// non-empty entries. An empty or whitespace-only input yields nil.
func splitList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

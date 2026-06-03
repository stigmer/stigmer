// Package mcpserver provides the public API for embedding the Stigmer MCP
// server into other Go programs (such as the Stigmer CLI).
//
// The package exposes a minimal surface: [Config] holds runtime settings,
// [DefaultConfig] reads them from environment variables, and [Run] starts
// the server.
package mcpserver

import (
	"log/slog"
	"strings"

	"github.com/stigmer/stigmer/mcp-server/internal/config"
)

// Config holds runtime settings for the MCP server. All fields use plain
// Go types so that callers outside the mcp-server module can construct a
// Config without importing internal packages.
type Config struct {
	// StigmerServerAddress is the gRPC dial target for stigmer-server
	// (e.g. "localhost:7234" or "api.stigmer.ai:443").
	StigmerServerAddress string

	// APIKey authenticates calls to stigmer-server. Required when Transport
	// is "stdio" or "both"; ignored for "http" (per-request Bearer tokens).
	APIKey string

	// Transport selects the communication mode: "stdio", "http", or "both".
	Transport string

	// HTTPPort is the TCP port for the HTTP transport (e.g. "8080").
	HTTPPort string

	// HTTPAuthEnabled controls whether HTTP requests require a valid
	// Authorization: Bearer token.
	HTTPAuthEnabled bool

	// OAuthEnabled turns on RFC 9728 OAuth discovery on the HTTP transport:
	// a /.well-known/oauth-protected-resource document and a WWW-Authenticate
	// challenge on unauthenticated requests. Defaults to false.
	OAuthEnabled bool

	// OAuthResource is the canonical resource identifier advertised in the
	// protected-resource metadata (e.g. "https://mcp.stigmer.ai"). Required
	// when OAuthEnabled is true.
	OAuthResource string

	// OAuthAuthorizationServers lists the OAuth issuer identifiers (RFC 8414)
	// advertised to clients. At least one is required when OAuthEnabled is true.
	OAuthAuthorizationServers []string

	// OAuthScopesSupported optionally advertises the scope values clients may
	// request. May be empty.
	OAuthScopesSupported []string

	// LogFormat selects the structured log encoding: "text" or "json".
	LogFormat string

	// LogLevel sets the minimum log severity: "debug", "info", "warn",
	// or "error".
	LogLevel string
}

// DefaultConfig returns a Config populated from environment variables.
// It applies the same defaults and validation as the standalone binary.
//
// Environment variables (see internal/config for the full list):
//
//	STIGMER_SERVER_ADDRESS        – gRPC address (default "localhost:7234")
//	STIGMER_API_KEY               – API key (required for stdio/both)
//	STIGMER_MCP_TRANSPORT         – "stdio" | "http" | "both" (default "stdio")
//	STIGMER_MCP_HTTP_PORT         – HTTP listen port (default "8080")
//	STIGMER_MCP_HTTP_AUTH_ENABLED – "true" | "false" (default "true")
//	STIGMER_MCP_LOG_FORMAT        – "text" | "json" (default "text")
//	STIGMER_MCP_LOG_LEVEL         – "debug" | "info" | "warn" | "error" (default "info")
func DefaultConfig() (*Config, error) {
	ic, err := config.LoadFromEnv()
	if err != nil {
		return nil, err
	}
	return fromInternal(ic), nil
}

// fromInternal maps an internal config to the public representation.
func fromInternal(ic *config.Config) *Config {
	return &Config{
		StigmerServerAddress:      ic.StigmerServerAddress,
		APIKey:                    ic.APIKey,
		Transport:                 string(ic.Transport),
		HTTPPort:                  ic.HTTPPort,
		HTTPAuthEnabled:           ic.HTTPAuthEnabled,
		OAuthEnabled:              ic.OAuth.Enabled,
		OAuthResource:             ic.OAuth.Resource,
		OAuthAuthorizationServers: ic.OAuth.AuthorizationServers,
		OAuthScopesSupported:      ic.OAuth.ScopesSupported,
		LogFormat:                 string(ic.LogFormat),
		LogLevel:                  logLevelString(ic.LogLevel),
	}
}

// toInternal converts the public Config to the internal representation,
// parsing string fields into typed values and validating invariants.
func (c *Config) toInternal() (*config.Config, error) {
	logLevel, err := config.ParseLogLevel(c.LogLevel)
	if err != nil {
		return nil, err
	}

	ic := &config.Config{
		StigmerServerAddress: c.StigmerServerAddress,
		APIKey:               c.APIKey,
		Transport:            config.Transport(strings.ToLower(c.Transport)),
		HTTPPort:             c.HTTPPort,
		HTTPAuthEnabled:      c.HTTPAuthEnabled,
		OAuth: config.OAuthMetadata{
			Enabled:              c.OAuthEnabled,
			Resource:             c.OAuthResource,
			AuthorizationServers: c.OAuthAuthorizationServers,
			ScopesSupported:      c.OAuthScopesSupported,
		},
		LogFormat: config.LogFormat(strings.ToLower(c.LogFormat)),
		LogLevel:  logLevel,
	}

	if err := ic.Validate(); err != nil {
		return nil, err
	}
	return ic, nil
}

// logLevelString converts an slog.Level back to its human-friendly name.
func logLevelString(l slog.Level) string {
	switch l {
	case slog.LevelDebug:
		return "debug"
	case slog.LevelInfo:
		return "info"
	case slog.LevelWarn:
		return "warn"
	case slog.LevelError:
		return "error"
	default:
		return "info"
	}
}

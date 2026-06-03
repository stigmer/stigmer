package mcpserver

import (
	"testing"
)

// clearEnv neutralizes all Stigmer env vars so that the ambient environment
// cannot leak into test assertions.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"STIGMER_SERVER_ADDRESS",
		"STIGMER_API_KEY",
		"STIGMER_MCP_TRANSPORT",
		"STIGMER_MCP_HTTP_PORT",
		"STIGMER_MCP_HTTP_AUTH_ENABLED",
		"STIGMER_MCP_OAUTH_ENABLED",
		"STIGMER_MCP_OAUTH_RESOURCE",
		"STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS",
		"STIGMER_MCP_OAUTH_SCOPES_SUPPORTED",
		"STIGMER_MCP_LOG_FORMAT",
		"STIGMER_MCP_LOG_LEVEL",
	} {
		t.Setenv(key, "")
	}
}

func TestDefaultConfig_populatesFromEnv(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_SERVER_ADDRESS", "api.example.com:443")
	t.Setenv("STIGMER_MCP_TRANSPORT", "http")
	t.Setenv("STIGMER_MCP_HTTP_PORT", "3000")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "json")
	t.Setenv("STIGMER_MCP_LOG_LEVEL", "debug")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.StigmerServerAddress != "api.example.com:443" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "api.example.com:443")
	}
	if cfg.APIKey != "test-key" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "test-key")
	}
	if cfg.Transport != "http" {
		t.Errorf("Transport = %q, want %q", cfg.Transport, "http")
	}
	if cfg.HTTPPort != "3000" {
		t.Errorf("HTTPPort = %q, want %q", cfg.HTTPPort, "3000")
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, "json")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}

func TestDefaultConfig_defaults(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.StigmerServerAddress != "localhost:7234" {
		t.Errorf("StigmerServerAddress = %q, want default %q", cfg.StigmerServerAddress, "localhost:7234")
	}
	if cfg.Transport != "stdio" {
		t.Errorf("Transport = %q, want default %q", cfg.Transport, "stdio")
	}
	if cfg.HTTPPort != "8080" {
		t.Errorf("HTTPPort = %q, want default %q", cfg.HTTPPort, "8080")
	}
	if !cfg.HTTPAuthEnabled {
		t.Error("HTTPAuthEnabled = false, want default true")
	}
	if cfg.LogFormat != "text" {
		t.Errorf("LogFormat = %q, want default %q", cfg.LogFormat, "text")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want default %q", cfg.LogLevel, "info")
	}
}

func TestDefaultConfig_propagatesOAuth(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_MCP_TRANSPORT", "http")
	t.Setenv("STIGMER_MCP_OAUTH_ENABLED", "true")
	t.Setenv("STIGMER_MCP_OAUTH_RESOURCE", "https://mcp.stigmer.ai")
	t.Setenv("STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS", "https://stigmer-prod.us.auth0.com/")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !cfg.OAuthEnabled {
		t.Error("OAuthEnabled = false, want true (env var dropped in public Config)")
	}
	if cfg.OAuthResource != "https://mcp.stigmer.ai" {
		t.Errorf("OAuthResource = %q, want %q", cfg.OAuthResource, "https://mcp.stigmer.ai")
	}
	if len(cfg.OAuthAuthorizationServers) != 1 {
		t.Fatalf("OAuthAuthorizationServers = %v, want one issuer", cfg.OAuthAuthorizationServers)
	}

	// And it must survive the toInternal() conversion the server runs on.
	ic, err := cfg.toInternal()
	if err != nil {
		t.Fatalf("toInternal() error: %v", err)
	}
	if !ic.OAuth.Enabled {
		t.Error("ic.OAuth.Enabled = false after full DefaultConfig→toInternal path, want true")
	}
}

func TestDefaultConfig_validationError(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_MCP_TRANSPORT", "websocket")

	_, err := DefaultConfig()
	if err == nil {
		t.Fatal("expected error for invalid transport, got nil")
	}
}

func TestConfig_toInternal_roundTrip(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress:      "api.stigmer.ai:443",
		APIKey:                    "my-key",
		Transport:                 "stdio",
		HTTPPort:                  "9090",
		HTTPAuthEnabled:           false,
		OAuthEnabled:              true,
		OAuthResource:             "https://mcp.stigmer.ai",
		OAuthAuthorizationServers: []string{"https://stigmer-prod.us.auth0.com/"},
		OAuthScopesSupported:      []string{"openid", "profile"},
		LogFormat:                 "json",
		LogLevel:                  "warn",
	}

	ic, err := cfg.toInternal()
	if err != nil {
		t.Fatalf("toInternal() error: %v", err)
	}

	// The internal config the server actually runs on must carry OAuth — a
	// regression guard for the public-Config round-trip silently dropping it
	// (which left RFC 9728 discovery disabled in prod despite env vars).
	if !ic.OAuth.Enabled {
		t.Error("ic.OAuth.Enabled = false, want true after toInternal()")
	}
	if ic.OAuth.Resource != "https://mcp.stigmer.ai" {
		t.Errorf("ic.OAuth.Resource = %q, want %q", ic.OAuth.Resource, "https://mcp.stigmer.ai")
	}
	if len(ic.OAuth.AuthorizationServers) != 1 || ic.OAuth.AuthorizationServers[0] != "https://stigmer-prod.us.auth0.com/" {
		t.Errorf("ic.OAuth.AuthorizationServers = %v, want [https://stigmer-prod.us.auth0.com/]", ic.OAuth.AuthorizationServers)
	}

	got := fromInternal(ic)

	if got.OAuthEnabled != cfg.OAuthEnabled {
		t.Errorf("OAuthEnabled = %v, want %v", got.OAuthEnabled, cfg.OAuthEnabled)
	}
	if got.OAuthResource != cfg.OAuthResource {
		t.Errorf("OAuthResource = %q, want %q", got.OAuthResource, cfg.OAuthResource)
	}
	if len(got.OAuthAuthorizationServers) != len(cfg.OAuthAuthorizationServers) {
		t.Errorf("OAuthAuthorizationServers = %v, want %v", got.OAuthAuthorizationServers, cfg.OAuthAuthorizationServers)
	}
	if len(got.OAuthScopesSupported) != len(cfg.OAuthScopesSupported) {
		t.Errorf("OAuthScopesSupported = %v, want %v", got.OAuthScopesSupported, cfg.OAuthScopesSupported)
	}

	if got.StigmerServerAddress != cfg.StigmerServerAddress {
		t.Errorf("StigmerServerAddress = %q, want %q", got.StigmerServerAddress, cfg.StigmerServerAddress)
	}
	if got.APIKey != cfg.APIKey {
		t.Errorf("APIKey = %q, want %q", got.APIKey, cfg.APIKey)
	}
	if got.Transport != cfg.Transport {
		t.Errorf("Transport = %q, want %q", got.Transport, cfg.Transport)
	}
	if got.HTTPPort != cfg.HTTPPort {
		t.Errorf("HTTPPort = %q, want %q", got.HTTPPort, cfg.HTTPPort)
	}
	if got.HTTPAuthEnabled != cfg.HTTPAuthEnabled {
		t.Errorf("HTTPAuthEnabled = %v, want %v", got.HTTPAuthEnabled, cfg.HTTPAuthEnabled)
	}
	if got.LogFormat != cfg.LogFormat {
		t.Errorf("LogFormat = %q, want %q", got.LogFormat, cfg.LogFormat)
	}
	if got.LogLevel != cfg.LogLevel {
		t.Errorf("LogLevel = %q, want %q", got.LogLevel, cfg.LogLevel)
	}
}

func TestConfig_toInternal_caseInsensitive(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress: "localhost:7234",
		APIKey:               "key",
		Transport:            "STDIO",
		HTTPPort:             "8080",
		HTTPAuthEnabled:      true,
		LogFormat:            "JSON",
		LogLevel:             "warn",
	}

	ic, err := cfg.toInternal()
	if err != nil {
		t.Fatalf("toInternal() error: %v", err)
	}
	if string(ic.Transport) != "stdio" {
		t.Errorf("Transport = %q, want normalized %q", ic.Transport, "stdio")
	}
	if string(ic.LogFormat) != "json" {
		t.Errorf("LogFormat = %q, want normalized %q", ic.LogFormat, "json")
	}
}

func TestConfig_toInternal_invalidTransport(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress: "localhost:7234",
		APIKey:               "key",
		Transport:            "grpc",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	_, err := cfg.toInternal()
	if err == nil {
		t.Fatal("expected error for invalid transport, got nil")
	}
}

func TestConfig_toInternal_invalidLogLevel(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress: "localhost:7234",
		APIKey:               "key",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "trace",
	}

	_, err := cfg.toInternal()
	if err == nil {
		t.Fatal("expected error for invalid log level, got nil")
	}
}

func TestConfig_toInternal_missingAPIKeyStdio(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress: "localhost:7234",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	ic, err := cfg.toInternal()
	if err != nil {
		t.Fatalf("unexpected error — empty API key should be valid: %v", err)
	}
	if ic.APIKey != "" {
		t.Errorf("APIKey = %q, want empty string", ic.APIKey)
	}
}

func TestConfig_toInternal_httpNoAPIKeyOK(t *testing.T) {
	cfg := &Config{
		StigmerServerAddress: "localhost:7234",
		Transport:            "http",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	_, err := cfg.toInternal()
	if err != nil {
		t.Fatalf("http mode should not require API key, got error: %v", err)
	}
}

func TestLogLevelString(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"debug", "debug", "debug"},
		{"info", "info", "info"},
		{"warn", "warn", "warn"},
		{"error", "error", "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &Config{
				StigmerServerAddress: "localhost:7234",
				APIKey:               "key",
				Transport:            "stdio",
				HTTPPort:             "8080",
				LogFormat:            "text",
				LogLevel:             tt.input,
			}
			ic, err := cfg.toInternal()
			if err != nil {
				t.Fatalf("toInternal() error: %v", err)
			}
			got := logLevelString(ic.LogLevel)
			if got != tt.want {
				t.Errorf("logLevelString() = %q, want %q", got, tt.want)
			}
		})
	}
}

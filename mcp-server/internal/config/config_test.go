package config

import (
	"log/slog"
	"testing"
)

// clearEnv neutralizes all Stigmer env vars so that the ambient environment
// (e.g. a developer's shell) cannot leak into test assertions. Every subtest
// should call this before setting the specific vars it cares about.
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

func TestLoadFromEnv_defaults(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.StigmerServerAddress != "localhost:7234" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "localhost:7234")
	}
	if cfg.Transport != TransportStdio {
		t.Errorf("Transport = %q, want %q", cfg.Transport, TransportStdio)
	}
	if cfg.HTTPPort != "8080" {
		t.Errorf("HTTPPort = %q, want %q", cfg.HTTPPort, "8080")
	}
	if !cfg.HTTPAuthEnabled {
		t.Error("HTTPAuthEnabled = false, want true")
	}
	if cfg.APIKey != "test-key" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "test-key")
	}
	if cfg.LogFormat != LogFormatText {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, LogFormatText)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want %v", cfg.LogLevel, slog.LevelInfo)
	}
}

func TestLoadFromEnv_overrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_SERVER_ADDRESS", "api.stigmer.ai:443")
	t.Setenv("STIGMER_API_KEY", "prod-key")
	t.Setenv("STIGMER_MCP_TRANSPORT", "http")
	t.Setenv("STIGMER_MCP_HTTP_PORT", "3000")
	t.Setenv("STIGMER_MCP_HTTP_AUTH_ENABLED", "false")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.StigmerServerAddress != "api.stigmer.ai:443" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "api.stigmer.ai:443")
	}
	if cfg.APIKey != "prod-key" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "prod-key")
	}
	if cfg.Transport != TransportHTTP {
		t.Errorf("Transport = %q, want %q", cfg.Transport, TransportHTTP)
	}
	if cfg.HTTPPort != "3000" {
		t.Errorf("HTTPPort = %q, want %q", cfg.HTTPPort, "3000")
	}
	if cfg.HTTPAuthEnabled {
		t.Error("HTTPAuthEnabled = true, want false")
	}
}

func TestLoadFromEnv_transportNormalization(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  Transport
	}{
		{"lowercase stdio", "stdio", TransportStdio},
		{"uppercase STDIO", "STDIO", TransportStdio},
		{"mixed case Http", "Http", TransportHTTP},
		{"lowercase both", "both", TransportBoth},
		{"uppercase BOTH", "BOTH", TransportBoth},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("STIGMER_API_KEY", "test-key")
			t.Setenv("STIGMER_MCP_TRANSPORT", tt.input)

			cfg, err := LoadFromEnv()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Transport != tt.want {
				t.Errorf("Transport = %q, want %q", cfg.Transport, tt.want)
			}
		})
	}
}

func TestLoadFromEnv_invalidTransport(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_TRANSPORT", "websocket")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for invalid transport, got nil")
	}
}

func TestLoadFromEnv_missingAPIKeyStdio(t *testing.T) {
	clearEnv(t)
	// Transport defaults to stdio; API key is empty — this is valid because
	// the local backend does not require authentication.
	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey = %q, want empty string", cfg.APIKey)
	}
}

func TestLoadFromEnv_missingAPIKeyBoth(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_MCP_TRANSPORT", "both")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey = %q, want empty string", cfg.APIKey)
	}
}

func TestLoadFromEnv_missingAPIKeyHTTP(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_MCP_TRANSPORT", "http")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("HTTP mode should not require API key, got error: %v", err)
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey = %q, want empty string", cfg.APIKey)
	}
}

func TestLoadFromEnv_emptyServerAddress(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_SERVER_ADDRESS", "")
	t.Setenv("STIGMER_MCP_TRANSPORT", "http")

	// envOr returns the fallback "localhost:7234" when the var is empty, so
	// the only way to trigger the "must not be empty" validation is if
	// someone bypasses envOr. With the current implementation, setting the
	// env var to empty uses the fallback, so this should succeed.
	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.StigmerServerAddress != "localhost:7234" {
		t.Errorf("StigmerServerAddress = %q, want fallback %q", cfg.StigmerServerAddress, "localhost:7234")
	}
}

func TestLoadFromEnv_httpAuthDisabled(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_HTTP_AUTH_ENABLED", "false")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HTTPAuthEnabled {
		t.Error("HTTPAuthEnabled = true, want false")
	}
}

func TestLoadFromEnv_httpAuthAnyNonTrue(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_HTTP_AUTH_ENABLED", "yes")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// "yes" != "true", so auth should be disabled.
	if cfg.HTTPAuthEnabled {
		t.Error("HTTPAuthEnabled = true for value \"yes\", want false (only \"true\" enables)")
	}
}

func TestValidate_directCall(t *testing.T) {
	t.Run("empty server address", func(t *testing.T) {
		c := &Config{
			Transport:            TransportHTTP,
			StigmerServerAddress: "",
		}
		if err := c.Validate(); err == nil {
			t.Error("expected error for empty server address, got nil")
		}
	})

	t.Run("valid minimal http config", func(t *testing.T) {
		c := &Config{
			Transport:            TransportHTTP,
			StigmerServerAddress: "localhost:7234",
			LogFormat:            LogFormatText,
		}
		if err := c.Validate(); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestLoadFromEnv_logFormatJSON(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "json")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.LogFormat != LogFormatJSON {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, LogFormatJSON)
	}
}

func TestLoadFromEnv_logFormatNormalization(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "JSON")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.LogFormat != LogFormatJSON {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, LogFormatJSON)
	}
}

func TestLoadFromEnv_invalidLogFormat(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "yaml")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for invalid log format, got nil")
	}
}

func TestLoadFromEnv_logLevelOverride(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  slog.Level
	}{
		{"debug", "debug", slog.LevelDebug},
		{"info", "info", slog.LevelInfo},
		{"warn", "warn", slog.LevelWarn},
		{"error", "error", slog.LevelError},
		{"uppercase DEBUG", "DEBUG", slog.LevelDebug},
		{"mixed case Warn", "Warn", slog.LevelWarn},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("STIGMER_API_KEY", "test-key")
			t.Setenv("STIGMER_MCP_LOG_LEVEL", tt.input)

			cfg, err := LoadFromEnv()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.LogLevel != tt.want {
				t.Errorf("LogLevel = %v, want %v", cfg.LogLevel, tt.want)
			}
		})
	}
}

func TestLoadFromEnv_invalidLogLevel(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_LOG_LEVEL", "trace")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for invalid log level, got nil")
	}
}

func TestLoadFromEnv_addressWithURLScheme(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_SERVER_ADDRESS", "https://api.stigmer.ai")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("URL-scheme address should load (with warning), got error: %v", err)
	}
	if cfg.StigmerServerAddress != "https://api.stigmer.ai" {
		t.Errorf("StigmerServerAddress = %q, want raw value preserved", cfg.StigmerServerAddress)
	}
}

func TestLoadFromEnv_addressWithoutPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_SERVER_ADDRESS", "api.stigmer.ai")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("portless address should load (with warning), got error: %v", err)
	}
	if cfg.StigmerServerAddress != "api.stigmer.ai" {
		t.Errorf("StigmerServerAddress = %q, want raw value preserved", cfg.StigmerServerAddress)
	}
}

func TestValidate_addressWithURLScheme(t *testing.T) {
	c := &Config{
		Transport:            TransportStdio,
		StigmerServerAddress: "https://api.stigmer.ai:443",
		LogFormat:            LogFormatText,
	}
	if err := c.Validate(); err != nil {
		t.Errorf("URL-scheme address should pass validation (with warning): %v", err)
	}
}

func TestValidate_addressWithoutPort(t *testing.T) {
	c := &Config{
		Transport:            TransportStdio,
		StigmerServerAddress: "api.stigmer.ai",
		LogFormat:            LogFormatText,
	}
	if err := c.Validate(); err != nil {
		t.Errorf("portless address should pass validation (with warning): %v", err)
	}
}

func TestLoadFromEnv_oauthDisabledByDefault(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OAuth.Enabled {
		t.Error("OAuth.Enabled = true, want false by default")
	}
}

func TestLoadFromEnv_oauthEnabled(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_OAUTH_ENABLED", "true")
	t.Setenv("STIGMER_MCP_OAUTH_RESOURCE", "https://mcp.stigmer.ai")
	t.Setenv("STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS", "https://stigmer-prod.us.auth0.com/ , https://alt.example.com/")
	t.Setenv("STIGMER_MCP_OAUTH_SCOPES_SUPPORTED", "openid,profile")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.OAuth.Enabled {
		t.Fatal("OAuth.Enabled = false, want true")
	}
	if cfg.OAuth.Resource != "https://mcp.stigmer.ai" {
		t.Errorf("OAuth.Resource = %q, want https://mcp.stigmer.ai", cfg.OAuth.Resource)
	}
	// splitList must trim surrounding whitespace and preserve order.
	wantServers := []string{"https://stigmer-prod.us.auth0.com/", "https://alt.example.com/"}
	if len(cfg.OAuth.AuthorizationServers) != len(wantServers) {
		t.Fatalf("AuthorizationServers = %v, want %v", cfg.OAuth.AuthorizationServers, wantServers)
	}
	for i, w := range wantServers {
		if cfg.OAuth.AuthorizationServers[i] != w {
			t.Errorf("AuthorizationServers[%d] = %q, want %q", i, cfg.OAuth.AuthorizationServers[i], w)
		}
	}
	if len(cfg.OAuth.ScopesSupported) != 2 {
		t.Errorf("ScopesSupported = %v, want [openid profile]", cfg.OAuth.ScopesSupported)
	}
}

func TestLoadFromEnv_oauthEnabledMissingResource(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_OAUTH_ENABLED", "true")
	t.Setenv("STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS", "https://stigmer-prod.us.auth0.com/")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected error when OAuth enabled without a resource, got nil")
	}
}

func TestLoadFromEnv_oauthEnabledMissingAuthorizationServers(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_OAUTH_ENABLED", "true")
	t.Setenv("STIGMER_MCP_OAUTH_RESOURCE", "https://mcp.stigmer.ai")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected error when OAuth enabled without authorization servers, got nil")
	}
}

func TestLoadFromEnv_oauthAnyNonTrueDisables(t *testing.T) {
	clearEnv(t)
	t.Setenv("STIGMER_API_KEY", "test-key")
	t.Setenv("STIGMER_MCP_OAUTH_ENABLED", "yes")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OAuth.Enabled {
		t.Error(`OAuth.Enabled = true for value "yes", want false (only "true" enables)`)
	}
}

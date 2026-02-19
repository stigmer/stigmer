package root

import (
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/mcp-server/pkg/mcpserver"
)

func TestNewMCPServerCommand_metadata(t *testing.T) {
	cmd := NewMCPServerCommand()

	if cmd.Use != "mcp-server" {
		t.Errorf("Use = %q, want %q", cmd.Use, "mcp-server")
	}
	if cmd.Short == "" {
		t.Error("Short description must not be empty")
	}
	if cmd.Long == "" {
		t.Error("Long description must not be empty")
	}
	if cmd.RunE == nil {
		t.Error("RunE must be set")
	}
}

func TestNewMCPServerCommand_flags(t *testing.T) {
	cmd := NewMCPServerCommand()

	flags := []string{
		"transport",
		"port",
		"server-address",
		"api-key",
		"log-format",
		"log-level",
	}

	for _, name := range flags {
		if cmd.Flags().Lookup(name) == nil {
			t.Errorf("expected flag %q to be registered", name)
		}
	}
}

func TestApplyFlagOverrides_setsOnlyExplicitFlags(t *testing.T) {
	cmd := NewMCPServerCommand()

	cfg := &mcpserver.Config{
		StigmerServerAddress: "original:9090",
		APIKey:               "original-key",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	// No flags set — config should remain unchanged.
	applyFlagOverrides(cmd, cfg)

	if cfg.StigmerServerAddress != "original:9090" {
		t.Errorf("StigmerServerAddress changed to %q", cfg.StigmerServerAddress)
	}
	if cfg.APIKey != "original-key" {
		t.Errorf("APIKey changed to %q", cfg.APIKey)
	}
	if cfg.Transport != "stdio" {
		t.Errorf("Transport changed to %q", cfg.Transport)
	}
	if cfg.HTTPPort != "8080" {
		t.Errorf("HTTPPort changed to %q", cfg.HTTPPort)
	}
	if cfg.LogFormat != "text" {
		t.Errorf("LogFormat changed to %q", cfg.LogFormat)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel changed to %q", cfg.LogLevel)
	}
}

// clearMCPEnv neutralizes the env vars that applyCLIConfig checks so that the
// developer's shell cannot leak into test assertions.
func clearMCPEnv(t *testing.T) {
	t.Helper()
	t.Setenv("STIGMER_SERVER_ADDRESS", "")
	t.Setenv("STIGMER_API_KEY", "")
}

func TestApplyCLIConfig_localBackend(t *testing.T) {
	clearMCPEnv(t)

	cfg := &mcpserver.Config{
		StigmerServerAddress: "localhost:9090",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "localhost:7234" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "localhost:7234")
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey = %q, want empty (local backend has no auth)", cfg.APIKey)
	}
}

func TestApplyCLIConfig_cloudBackend(t *testing.T) {
	clearMCPEnv(t)

	cfg := &mcpserver.Config{
		StigmerServerAddress: "localhost:9090",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "api.stigmer.ai:443" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "api.stigmer.ai:443")
	}
	if cfg.APIKey != "sk-cloud-token" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "sk-cloud-token")
	}
}

func TestApplyCLIConfig_envVarsTakePrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:9090")
	t.Setenv("STIGMER_API_KEY", "env-key")

	cfg := &mcpserver.Config{
		StigmerServerAddress: "custom:9090",
		APIKey:               "env-key",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "custom:9090" {
		t.Errorf("StigmerServerAddress = %q, want %q (env var should take precedence)", cfg.StigmerServerAddress, "custom:9090")
	}
	if cfg.APIKey != "env-key" {
		t.Errorf("APIKey = %q, want %q (env var should take precedence)", cfg.APIKey, "env-key")
	}
}

func TestApplyCLIConfig_cloudNilCloudConfig(t *testing.T) {
	clearMCPEnv(t)

	cfg := &mcpserver.Config{
		StigmerServerAddress: "localhost:9090",
		APIKey:               "original",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: nil,
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "localhost:9090" {
		t.Errorf("StigmerServerAddress = %q, want %q (should be unchanged with nil Cloud)", cfg.StigmerServerAddress, "localhost:9090")
	}
	if cfg.APIKey != "original" {
		t.Errorf("APIKey = %q, want %q (should be unchanged with nil Cloud)", cfg.APIKey, "original")
	}
}

func TestApplyCLIConfig_cloudEmptyEndpointAndToken(t *testing.T) {
	clearMCPEnv(t)

	cfg := &mcpserver.Config{
		StigmerServerAddress: "localhost:9090",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "",
				Token:    "",
			},
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "localhost:9090" {
		t.Errorf("StigmerServerAddress = %q, want %q (empty endpoint should not override)", cfg.StigmerServerAddress, "localhost:9090")
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey = %q, want empty (empty token should not override)", cfg.APIKey)
	}
}

func TestApplyCLIConfig_localEnvVarTakesPrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:7234")
	t.Setenv("STIGMER_API_KEY", "")

	cfg := &mcpserver.Config{
		StigmerServerAddress: "custom:7234",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "custom:7234" {
		t.Errorf("StigmerServerAddress = %q, want %q (env var should take precedence over local default)", cfg.StigmerServerAddress, "custom:7234")
	}
}

func TestApplyCLIConfig_unknownBackendType(t *testing.T) {
	clearMCPEnv(t)

	cfg := &mcpserver.Config{
		StigmerServerAddress: "localhost:9090",
		APIKey:               "original",
	}
	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: "unknown",
		},
	}

	applyCLIConfig(cfg, cliCfg)

	if cfg.StigmerServerAddress != "localhost:9090" {
		t.Errorf("StigmerServerAddress = %q, want %q (unknown backend should not change config)", cfg.StigmerServerAddress, "localhost:9090")
	}
	if cfg.APIKey != "original" {
		t.Errorf("APIKey = %q, want %q (unknown backend should not change config)", cfg.APIKey, "original")
	}
}

func TestApplyFlagOverrides_appliesValues(t *testing.T) {
	cmd := NewMCPServerCommand()

	if err := cmd.Flags().Set("transport", "http"); err != nil {
		t.Fatalf("setting transport flag: %v", err)
	}
	if err := cmd.Flags().Set("port", "3000"); err != nil {
		t.Fatalf("setting port flag: %v", err)
	}
	if err := cmd.Flags().Set("server-address", "api.example.com:443"); err != nil {
		t.Fatalf("setting server-address flag: %v", err)
	}
	if err := cmd.Flags().Set("api-key", "new-key"); err != nil {
		t.Fatalf("setting api-key flag: %v", err)
	}
	if err := cmd.Flags().Set("log-format", "json"); err != nil {
		t.Fatalf("setting log-format flag: %v", err)
	}
	if err := cmd.Flags().Set("log-level", "debug"); err != nil {
		t.Fatalf("setting log-level flag: %v", err)
	}

	cfg := &mcpserver.Config{
		StigmerServerAddress: "original:9090",
		APIKey:               "original-key",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	applyFlagOverrides(cmd, cfg)

	if cfg.Transport != "http" {
		t.Errorf("Transport = %q, want %q", cfg.Transport, "http")
	}
	if cfg.HTTPPort != "3000" {
		t.Errorf("HTTPPort = %q, want %q", cfg.HTTPPort, "3000")
	}
	if cfg.StigmerServerAddress != "api.example.com:443" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "api.example.com:443")
	}
	if cfg.APIKey != "new-key" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "new-key")
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, "json")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}

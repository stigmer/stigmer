package root

import (
	"os"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
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

func TestBridgeFlagsToEnv(t *testing.T) {
	clearMCPEnv(t)

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

	bridgeFlagsToEnv(cmd)

	assertEnv(t, "STIGMER_MCP_TRANSPORT", "http")
	assertEnv(t, "STIGMER_MCP_HTTP_PORT", "3000")
	assertEnv(t, "STIGMER_SERVER_ADDRESS", "api.example.com:443")
	assertEnv(t, "STIGMER_API_KEY", "new-key")
	assertEnv(t, "STIGMER_MCP_LOG_FORMAT", "json")
	assertEnv(t, "STIGMER_MCP_LOG_LEVEL", "debug")
}

func TestBridgeFlagsToEnv_noFlagsDoesNotOverwrite(t *testing.T) {
	t.Setenv("STIGMER_MCP_TRANSPORT", "original")

	cmd := NewMCPServerCommand()
	bridgeFlagsToEnv(cmd)

	assertEnv(t, "STIGMER_MCP_TRANSPORT", "original")
}

// clearMCPEnv neutralizes the env vars that applyCLIConfigEnv checks so that
// the developer's shell cannot leak into test assertions.
func clearMCPEnv(t *testing.T) {
	t.Helper()
	t.Setenv("STIGMER_SERVER_ADDRESS", "")
	t.Setenv("STIGMER_API_KEY", "")
	t.Setenv("STIGMER_MCP_TRANSPORT", "")
	t.Setenv("STIGMER_MCP_HTTP_PORT", "")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "")
	t.Setenv("STIGMER_MCP_LOG_LEVEL", "")
}

func TestApplyCLIConfigEnv_localBackend(t *testing.T) {
	clearMCPEnv(t)

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "localhost:7234")
	assertEnv(t, "STIGMER_API_KEY", "")
}

func TestApplyCLIConfigEnv_cloudBackend(t *testing.T) {
	clearMCPEnv(t)

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "api.stigmer.ai:443")
	assertEnv(t, "STIGMER_API_KEY", "sk-cloud-token")
}

func TestApplyCLIConfigEnv_envVarsTakePrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:9090")
	t.Setenv("STIGMER_API_KEY", "env-key")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "custom:9090")
	assertEnv(t, "STIGMER_API_KEY", "env-key")
}

func TestApplyCLIConfigEnv_cloudNilCloudConfig(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "original")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: nil,
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "original")
}

func TestApplyCLIConfigEnv_cloudEmptyEndpointAndToken(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "",
				Token:    "",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "")
}

func TestApplyCLIConfigEnv_localEnvVarTakesPrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:7234")
	t.Setenv("STIGMER_API_KEY", "")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "custom:7234")
}

func TestApplyCLIConfigEnv_unknownBackendType(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "original")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: "unknown",
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "original")
}

func TestBuildMCPServerArgs_withTransport(t *testing.T) {
	cmd := NewMCPServerCommand()
	if err := cmd.Flags().Set("transport", "http"); err != nil {
		t.Fatal(err)
	}

	args := buildMCPServerArgs(cmd)
	if len(args) != 2 || args[0] != mcpServerBinaryName || args[1] != "http" {
		t.Errorf("args = %v, want [%s http]", args, mcpServerBinaryName)
	}
}

func TestBuildMCPServerArgs_noTransport(t *testing.T) {
	cmd := NewMCPServerCommand()

	args := buildMCPServerArgs(cmd)
	if len(args) != 1 || args[0] != mcpServerBinaryName {
		t.Errorf("args = %v, want [%s]", args, mcpServerBinaryName)
	}
}

func assertEnv(t *testing.T, key, want string) {
	t.Helper()
	if got := os.Getenv(key); got != want {
		t.Errorf("%s = %q, want %q", key, got, want)
	}
}

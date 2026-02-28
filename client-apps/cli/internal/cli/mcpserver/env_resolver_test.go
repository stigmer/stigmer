package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	envv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

func makeServerWithEnvSpec(vars map[string]bool) *mcpserverv1.McpServer {
	data := make(map[string]*envv1.EnvironmentValue)
	for name, isSecret := range vars {
		data[name] = &envv1.EnvironmentValue{
			IsSecret:    isSecret,
			Description: "test var " + name,
		}
	}
	return &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test-server"},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{Command: "echo"},
			},
			EnvSpec: &envv1.EnvironmentSpec{Data: data},
		},
	}
}

func TestResolveEnvForDiscovery_StigmerVars(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"STIGMER_SERVER_ADDRESS": false,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	require.NotNil(t, result)
	assert.Contains(t, result.Overrides, "STIGMER_SERVER_ADDRESS=localhost:7234")
	assert.Empty(t, result.Unresolved)
}

func TestResolveEnvForDiscovery_UnknownVarsAreUnresolved(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"UNKNOWN_VAR": false,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Empty(t, result.Overrides)
	assert.Contains(t, result.Unresolved, "UNKNOWN_VAR")
}

func TestResolveEnvForDiscovery_EnvVarTakesPriority(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:1234")

	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"STIGMER_SERVER_ADDRESS": false,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Empty(t, result.Overrides, "should not override when env var is set")
	assert.Empty(t, result.Unresolved)
}

func TestResolveEnvForDiscovery_EmptyEnvSpec(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec:     &mcpserverv1.McpServerSpec{},
	}

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Empty(t, result.Overrides)
	assert.Empty(t, result.Unresolved)
}

func TestResolveStigmerServerAddress_Local(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	assert.Equal(t, "localhost:7234", resolveStigmerServerAddress(cfg))
}

func TestResolveStigmerServerAddress_Cloud(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "custom.stigmer.ai:443",
			},
		},
	}
	assert.Equal(t, "custom.stigmer.ai:443", resolveStigmerServerAddress(cfg))
}

func TestResolveStigmerServerAddress_CloudDefault(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{},
		},
	}
	assert.Equal(t, "api.stigmer.ai:443", resolveStigmerServerAddress(cfg))
}

func TestResolvePlantonAPIKey_WithTokenJSON(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	credDir := filepath.Join(home, ".planton", "credentials", "production")
	require.NoError(t, os.MkdirAll(credDir, 0700))

	tokenData, _ := json.Marshal(map[string]string{
		"access_token":  "test-planton-token-abc123",
		"refresh_token": "refresh-xyz",
		"token_type":    "Bearer",
	})
	require.NoError(t, os.WriteFile(filepath.Join(credDir, "token.json"), tokenData, 0600))

	token, ok := resolvePlantonAPIKey()

	assert.True(t, ok)
	assert.Equal(t, "test-planton-token-abc123", token)
}

func TestResolvePlantonAPIKey_WithCustomEnvironment(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, ".planton")
	require.NoError(t, os.MkdirAll(configDir, 0700))
	require.NoError(t, os.WriteFile(
		filepath.Join(configDir, "config.yaml"),
		[]byte("current_environment: staging\n"),
		0600,
	))

	credDir := filepath.Join(home, ".planton", "credentials", "staging")
	require.NoError(t, os.MkdirAll(credDir, 0700))

	tokenData, _ := json.Marshal(map[string]string{
		"access_token": "staging-token",
	})
	require.NoError(t, os.WriteFile(filepath.Join(credDir, "token.json"), tokenData, 0600))

	token, ok := resolvePlantonAPIKey()

	assert.True(t, ok)
	assert.Equal(t, "staging-token", token)
}

func TestResolvePlantonAPIKey_NoCredentials(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	token, ok := resolvePlantonAPIKey()

	assert.False(t, ok)
	assert.Empty(t, token)
}

func TestResolvePlantonAPIKey_InvalidJSON(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	credDir := filepath.Join(home, ".planton", "credentials", "production")
	require.NoError(t, os.MkdirAll(credDir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(credDir, "token.json"), []byte("not json"), 0600))

	token, ok := resolvePlantonAPIKey()

	assert.False(t, ok)
	assert.Empty(t, token)
}

func TestResolvePlantonAPIKey_EmptyAccessToken(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	credDir := filepath.Join(home, ".planton", "credentials", "production")
	require.NoError(t, os.MkdirAll(credDir, 0700))

	tokenData, _ := json.Marshal(map[string]string{
		"access_token": "",
	})
	require.NoError(t, os.WriteFile(filepath.Join(credDir, "token.json"), tokenData, 0600))

	token, ok := resolvePlantonAPIKey()

	assert.False(t, ok)
	assert.Empty(t, token)
}

func TestResolvePlantonEnvironment_DefaultsToProduction(t *testing.T) {
	assert.Equal(t, "production", resolvePlantonEnvironment("/nonexistent/config.yaml"))
}

func TestResolvePlantonEnvironment_ReadsFromConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte("current_environment: dev\n"), 0600))

	assert.Equal(t, "dev", resolvePlantonEnvironment(configPath))
}

func TestResolvePlantonEnvironment_EmptyFieldDefaultsToProduction(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte("version: 1\n"), 0600))

	assert.Equal(t, "production", resolvePlantonEnvironment(configPath))
}

func TestResolveGithubToken_FallsBackGracefully(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	token, ok := resolveGithubToken()

	assert.False(t, ok)
	assert.Empty(t, token)
}

func TestFormatDiscoverySkipMessage_SingleVar(t *testing.T) {
	msg := FormatDiscoverySkipMessage("github-mcp-server", []string{"GITHUB_TOKEN"})

	assert.Contains(t, msg, "Discovery skipped for github-mcp-server")
	assert.Contains(t, msg, "GITHUB_TOKEN not available")
	assert.Contains(t, msg, "GITHUB_TOKEN=<value> stigmer discover mcp-server github-mcp-server")
}

func TestFormatDiscoverySkipMessage_MultipleVars(t *testing.T) {
	msg := FormatDiscoverySkipMessage("planton-server", []string{"PLANTON_API_KEY", "PLANTON_ORG"})

	assert.Contains(t, msg, "PLANTON_API_KEY, PLANTON_ORG not available")
	assert.Contains(t, msg, "PLANTON_API_KEY=<value> PLANTON_ORG=<value> stigmer discover mcp-server planton-server")
}

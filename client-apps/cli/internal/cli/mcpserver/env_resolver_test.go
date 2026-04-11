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
	data := make(map[string]*envv1.EnvVarDeclaration)
	for name, isSecret := range vars {
		data[name] = &envv1.EnvVarDeclaration{
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
			Env: data,
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

func TestResolveEnvForDiscovery_NonSecretUnknownVarsAreOptional(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"UNKNOWN_VAR": false,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Empty(t, result.Overrides)
	assert.Empty(t, result.Unresolved, "non-secret var should not block discovery")
	assert.Contains(t, result.UnresolvedOptional, "UNKNOWN_VAR")
}

func TestResolveEnvForDiscovery_SecretUnknownVarsAreBlocking(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"UNKNOWN_SECRET": true,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Empty(t, result.Overrides)
	assert.Contains(t, result.Unresolved, "UNKNOWN_SECRET")
	assert.Empty(t, result.UnresolvedOptional, "secret var should block discovery")
}

func TestResolveEnvForDiscovery_MixedSecretAndNonSecret(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	server := makeServerWithEnvSpec(map[string]bool{
		"STIGMER_SERVER_ADDRESS": false,
		"OPTIONAL_CONFIG":        false,
		"MISSING_CREDENTIAL":     true,
	})

	result := ResolveEnvForDiscovery(server, cfg)

	assert.Contains(t, result.Overrides, "STIGMER_SERVER_ADDRESS=localhost:7234")
	assert.Contains(t, result.Unresolved, "MISSING_CREDENTIAL")
	assert.Contains(t, result.UnresolvedOptional, "OPTIONAL_CONFIG")
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

// --- ResolveWellKnownEnv tests ---

func TestResolveWellKnownEnv_StigmerVars(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "test-api-key",
			},
		},
	}

	result := ResolveWellKnownEnv(cfg)

	require.NotNil(t, result)

	addr, ok := result["STIGMER_SERVER_ADDRESS"]
	require.True(t, ok, "should resolve STIGMER_SERVER_ADDRESS")
	assert.Equal(t, "api.stigmer.ai:443", addr.Value)
	assert.False(t, addr.IsSecret, "server address is not a secret")

	key, ok := result["STIGMER_API_KEY"]
	require.True(t, ok, "should resolve STIGMER_API_KEY")
	assert.Equal(t, "test-api-key", key.Value)
	assert.True(t, key.IsSecret, "API key is a secret")
}

func TestResolveWellKnownEnv_SkipsVarsInShellEnv(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "user-provided:9999")

	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	result := ResolveWellKnownEnv(cfg)

	_, ok := result["STIGMER_SERVER_ADDRESS"]
	assert.False(t, ok, "should not override when shell env is set")
}

func TestResolveWellKnownEnv_EmptyWhenNothingResolvable(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("HOME", t.TempDir())

	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	result := ResolveWellKnownEnv(cfg)

	require.NotNil(t, result, "should return empty map, not nil")
	_, hasGithub := result["GITHUB_TOKEN"]
	assert.False(t, hasGithub, "gh not on PATH, should not resolve")
	_, hasPlanton := result["PLANTON_API_KEY"]
	assert.False(t, hasPlanton, "no planton credentials, should not resolve")
	_, hasStigmerAddr := result["STIGMER_SERVER_ADDRESS"]
	assert.True(t, hasStigmerAddr, "local backend always resolves server address")
}

func TestResolveWellKnownEnv_PlantonAPIKey(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	credDir := filepath.Join(home, ".planton", "credentials", "production")
	require.NoError(t, os.MkdirAll(credDir, 0700))

	tokenData, _ := json.Marshal(map[string]string{
		"access_token": "planton-token-for-run",
	})
	require.NoError(t, os.WriteFile(filepath.Join(credDir, "token.json"), tokenData, 0600))

	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	result := ResolveWellKnownEnv(cfg)

	val, ok := result["PLANTON_API_KEY"]
	require.True(t, ok, "should resolve PLANTON_API_KEY")
	assert.Equal(t, "planton-token-for-run", val.Value)
	assert.True(t, val.IsSecret, "PLANTON_API_KEY is a secret")
}

func TestResolveWellKnownEnv_LocalBackendNoAPIKey(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	result := ResolveWellKnownEnv(cfg)

	_, ok := result["STIGMER_API_KEY"]
	assert.False(t, ok, "local backend has no API key to resolve")
}

// --- ResolveWellKnownEnvScoped tests ---

func TestResolveWellKnownEnvScoped_OnlyResolvesRequiredVars(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "test-api-key",
			},
		},
	}

	required := map[string]bool{
		"STIGMER_SERVER_ADDRESS": true,
	}

	result := ResolveWellKnownEnvScoped(cfg, required)

	_, hasAddr := result["STIGMER_SERVER_ADDRESS"]
	assert.True(t, hasAddr, "should resolve STIGMER_SERVER_ADDRESS (required)")

	_, hasKey := result["STIGMER_API_KEY"]
	assert.False(t, hasKey, "should NOT resolve STIGMER_API_KEY (not required)")

	_, hasGithub := result["GITHUB_TOKEN"]
	assert.False(t, hasGithub, "should NOT resolve GITHUB_TOKEN (not required)")
}

func TestResolveWellKnownEnvScoped_EmptyRequiredResolvesNothing(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "test-api-key",
			},
		},
	}

	result := ResolveWellKnownEnvScoped(cfg, map[string]bool{})

	assert.Empty(t, result, "empty required set should resolve nothing")
}

func TestResolveWellKnownEnvScoped_NonWellKnownVarsIgnored(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	required := map[string]bool{
		"CUSTOM_VAR":             true,
		"STIGMER_SERVER_ADDRESS": true,
	}

	result := ResolveWellKnownEnvScoped(cfg, required)

	_, hasAddr := result["STIGMER_SERVER_ADDRESS"]
	assert.True(t, hasAddr, "should resolve STIGMER_SERVER_ADDRESS (well-known + required)")

	_, hasCustom := result["CUSTOM_VAR"]
	assert.False(t, hasCustom, "CUSTOM_VAR is not well-known, cannot be auto-resolved")
}

func TestResolveWellKnownEnvScoped_ShellEnvStillWins(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "user-override:9999")

	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	required := map[string]bool{
		"STIGMER_SERVER_ADDRESS": true,
	}

	result := ResolveWellKnownEnvScoped(cfg, required)

	_, ok := result["STIGMER_SERVER_ADDRESS"]
	assert.False(t, ok, "shell env should still take priority")
}

// --- isSecretVar tests ---

func TestIsSecretVar(t *testing.T) {
	assert.True(t, isSecretVar("GITHUB_TOKEN"))
	assert.True(t, isSecretVar("PLANTON_API_KEY"))
	assert.True(t, isSecretVar("STIGMER_API_KEY"))
	assert.False(t, isSecretVar("STIGMER_SERVER_ADDRESS"))
	assert.False(t, isSecretVar("UNKNOWN_VAR"))
}

// --- FormatDiscoverySkipMessage tests ---

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

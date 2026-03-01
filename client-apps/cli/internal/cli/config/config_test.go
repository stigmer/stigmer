package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Helpers
// =============================================================================

func createTestConfigFile(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, ConfigFileName)
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

func minimalLocalConfig() string {
	return `backend:
  type: local
`
}

func fullLocalConfig() string {
	return `backend:
  type: local
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
    temporal:
      managed: true
    execution:
      mode: local
      auto_pull: true
      cleanup: true
`
}

func cloudConfig() string {
	return `backend:
  type: cloud
  cloud:
    endpoint: api.stigmer.ai:443
    org_id: org_123
context:
  organization: my-org
  environment: production
`
}

// =============================================================================
// GetDefault Tests
// =============================================================================

func TestGetDefault_ReturnsLocalBackend(t *testing.T) {
	config := GetDefault()

	require.NotNil(t, config)
	assert.Equal(t, BackendTypeLocal, config.Backend.Type)
	assert.NotNil(t, config.Backend.Local)
}

func TestGetDefault_HasManagedTemporal(t *testing.T) {
	config := GetDefault()

	require.NotNil(t, config.Backend.Local)
	require.NotNil(t, config.Backend.Local.Temporal)
	assert.True(t, config.Backend.Local.Temporal.Managed)
}

func TestGetDefault_HasDefaultExecution(t *testing.T) {
	config := GetDefault()

	require.NotNil(t, config.Backend.Local)
	require.NotNil(t, config.Backend.Local.Execution)
	assert.Equal(t, "local", config.Backend.Local.Execution.Mode)
	assert.True(t, config.Backend.Local.Execution.AutoPull)
	assert.True(t, config.Backend.Local.Execution.Cleanup)
	assert.Equal(t, 3600, config.Backend.Local.Execution.TTL)
}

// =============================================================================
// Path Functions Tests (require $HOME)
// =============================================================================

// Note: These tests are skipped in environments where $HOME is not set (like Bazel tests)
// They would test GetConfigPath(), GetConfigDir(), GetDataDir() functions

// =============================================================================
// IsInitialized Tests
// =============================================================================

func TestIsInitialized_TrueWhenConfigExists(t *testing.T) {
	// Create temporary home directory
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)
	err := os.MkdirAll(configDir, 0755)
	require.NoError(t, err)

	// Create config file
	configPath := filepath.Join(configDir, ConfigFileName)
	err = os.WriteFile(configPath, []byte(minimalLocalConfig()), 0644)
	require.NoError(t, err)

	// Set HOME to temp dir
	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	initialized := IsInitialized()
	assert.True(t, initialized)
}

func TestIsInitialized_FalseWhenConfigMissing(t *testing.T) {
	// Create temporary home directory without config
	tmpHome := t.TempDir()

	// Set HOME to temp dir
	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	initialized := IsInitialized()
	assert.False(t, initialized)
}

// =============================================================================
// Load Tests (Integration Style)
// =============================================================================

func TestLoad_DefaultConfigWhenFileNotFound(t *testing.T) {
	// Use temp home to ensure clean test
	tmpHome := t.TempDir()
	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config, err := Load()

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, BackendTypeLocal, config.Backend.Type)
}

func TestLoad_ParsesLocalConfig(t *testing.T) {
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)
	err := os.MkdirAll(configDir, 0755)
	require.NoError(t, err)

	createTestConfigFile(t, configDir, fullLocalConfig())

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config, err := Load()

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, BackendTypeLocal, config.Backend.Type)
	assert.NotNil(t, config.Backend.Local)
	assert.NotNil(t, config.Backend.Local.LLM)
	assert.Equal(t, "anthropic", config.Backend.Local.LLM.Provider)
	assert.Equal(t, "claude-sonnet-4.5", config.Backend.Local.LLM.Model)
}

func TestLoad_ParsesCloudConfig(t *testing.T) {
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)
	err := os.MkdirAll(configDir, 0755)
	require.NoError(t, err)

	createTestConfigFile(t, configDir, cloudConfig())

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config, err := Load()

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, BackendTypeCloud, config.Backend.Type)
	assert.NotNil(t, config.Backend.Cloud)
	assert.Equal(t, "api.stigmer.ai:443", config.Backend.Cloud.Endpoint)
	assert.Equal(t, "org_123", config.Backend.Cloud.OrgID)
	assert.Equal(t, "my-org", config.Context.Organization)
	assert.Equal(t, "production", config.Context.Environment)
}

// =============================================================================
// Save Tests
// =============================================================================

func TestSave_CreatesConfigFile(t *testing.T) {
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config := GetDefault()
	err := Save(config)

	require.NoError(t, err)

	// Verify file exists
	configPath := filepath.Join(configDir, ConfigFileName)
	_, err = os.Stat(configPath)
	assert.NoError(t, err)
}

func TestSave_PreservesConfigData(t *testing.T) {
	tmpHome := t.TempDir()

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	// Create and save config
	config := &Config{
		Backend: BackendConfig{
			Type: BackendTypeCloud,
			Cloud: &CloudBackendConfig{
				Endpoint: "custom.stigmer.ai:443",
				OrgID:    "org_custom",
			},
		},
		Context: ContextConfig{
			Organization: "test-org",
			Environment:  "staging",
		},
	}

	err := Save(config)
	require.NoError(t, err)

	// Load and verify
	loadedConfig, err := Load()
	require.NoError(t, err)
	assert.Equal(t, BackendTypeCloud, loadedConfig.Backend.Type)
	assert.Equal(t, "custom.stigmer.ai:443", loadedConfig.Backend.Cloud.Endpoint)
	assert.Equal(t, "org_custom", loadedConfig.Backend.Cloud.OrgID)
	assert.Equal(t, "test-org", loadedConfig.Context.Organization)
	assert.Equal(t, "staging", loadedConfig.Context.Environment)
}

// =============================================================================
// Backend Type Verification Tests
// =============================================================================

func TestConfig_BackendTypeLocal(t *testing.T) {
	config := &Config{
		Backend: BackendConfig{
			Type: BackendTypeLocal,
		},
	}

	assert.Equal(t, BackendTypeLocal, config.Backend.Type)
}

func TestConfig_BackendTypeCloud(t *testing.T) {
	config := &Config{
		Backend: BackendConfig{
			Type: BackendTypeCloud,
		},
	}

	assert.Equal(t, BackendTypeCloud, config.Backend.Type)
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestLoad_InvalidYAML(t *testing.T) {
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)
	err := os.MkdirAll(configDir, 0755)
	require.NoError(t, err)

	invalidYAML := `backend:
  type: [unclosed list
`
	createTestConfigFile(t, configDir, invalidYAML)

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config, err := Load()

	require.Error(t, err)
	assert.Nil(t, config)
	assert.Contains(t, err.Error(), "failed to unmarshal config YAML")
}

func TestSave_CreatesDirectoryIfMissing(t *testing.T) {
	tmpHome := t.TempDir()
	// Don't create config dir - Save should create it

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config := GetDefault()
	err := Save(config)

	require.NoError(t, err)

	// Verify directory was created
	configDir := filepath.Join(tmpHome, ConfigDir)
	info, err := os.Stat(configDir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

// =============================================================================
// Backward Compatibility Tests
// =============================================================================

func TestLoad_HandlesMinimalConfig(t *testing.T) {
	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ConfigDir)
	err := os.MkdirAll(configDir, 0755)
	require.NoError(t, err)

	// Minimal valid config
	minimalConfig := minimalLocalConfig()
	createTestConfigFile(t, configDir, minimalConfig)

	originalHome := os.Getenv("HOME")
	defer os.Setenv("HOME", originalHome)
	os.Setenv("HOME", tmpHome)

	config, err := Load()

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, BackendTypeLocal, config.Backend.Type)
}

// =============================================================================
// DetectProviderFromAPIKeys Tests
// =============================================================================

func clearLLMEnvVars(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"STIGMER_LLM_PROVIDER",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
	} {
		original := os.Getenv(key)
		os.Unsetenv(key)
		t.Cleanup(func() {
			if original != "" {
				os.Setenv(key, original)
			}
		})
	}
}

func TestDetectProviderFromAPIKeys_Anthropic(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	assert.Equal(t, "anthropic", DetectProviderFromAPIKeys())
}

func TestDetectProviderFromAPIKeys_OpenAI(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("OPENAI_API_KEY", "sk-test")

	assert.Equal(t, "openai", DetectProviderFromAPIKeys())
}

func TestDetectProviderFromAPIKeys_BothSet_AnthropicWins(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")
	os.Setenv("OPENAI_API_KEY", "sk-test")

	assert.Equal(t, "anthropic", DetectProviderFromAPIKeys())
}

func TestDetectProviderFromAPIKeys_NeitherSet(t *testing.T) {
	clearLLMEnvVars(t)

	assert.Equal(t, "", DetectProviderFromAPIKeys())
}

// =============================================================================
// ResolveLLMProvider Cascading Fallback Tests
// =============================================================================

func TestResolveLLMProvider_ExplicitEnvVarWins(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("STIGMER_LLM_PROVIDER", "openai")
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	cfg := &LocalBackendConfig{
		LLM: &LLMConfig{Provider: "ollama"},
	}

	assert.Equal(t, "openai", cfg.ResolveLLMProvider())
}

func TestResolveLLMProvider_ConfigFileBeatsAutoDetect(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	cfg := &LocalBackendConfig{
		LLM: &LLMConfig{Provider: "ollama"},
	}

	assert.Equal(t, "ollama", cfg.ResolveLLMProvider())
}

func TestResolveLLMProvider_AutoDetectFallback(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	cfg := &LocalBackendConfig{}

	assert.Equal(t, "anthropic", cfg.ResolveLLMProvider())
}

func TestResolveLLMProvider_EmptyWhenNothingAvailable(t *testing.T) {
	clearLLMEnvVars(t)

	cfg := &LocalBackendConfig{}

	assert.Equal(t, "", cfg.ResolveLLMProvider())
}

// =============================================================================
// ResolveLLMProviderSource Tests
// =============================================================================

func TestResolveLLMProviderSource_EnvOverride(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("STIGMER_LLM_PROVIDER", "anthropic")

	cfg := &LocalBackendConfig{}

	assert.Equal(t, ProviderSourceEnvOverride, cfg.ResolveLLMProviderSource())
}

func TestResolveLLMProviderSource_ConfigFile(t *testing.T) {
	clearLLMEnvVars(t)

	cfg := &LocalBackendConfig{
		LLM: &LLMConfig{Provider: "anthropic"},
	}

	assert.Equal(t, ProviderSourceConfigFile, cfg.ResolveLLMProviderSource())
}

func TestResolveLLMProviderSource_AnthropicKey(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	cfg := &LocalBackendConfig{}

	assert.Equal(t, ProviderSourceAnthropicKey, cfg.ResolveLLMProviderSource())
}

func TestResolveLLMProviderSource_OpenAIKey(t *testing.T) {
	clearLLMEnvVars(t)
	os.Setenv("OPENAI_API_KEY", "sk-test")

	cfg := &LocalBackendConfig{}

	assert.Equal(t, ProviderSourceOpenAIKey, cfg.ResolveLLMProviderSource())
}

func TestResolveLLMProviderSource_None(t *testing.T) {
	clearLLMEnvVars(t)

	cfg := &LocalBackendConfig{}

	assert.Equal(t, ProviderSourceNone, cfg.ResolveLLMProviderSource())
}

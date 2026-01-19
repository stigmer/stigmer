package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

const (
	// ConfigDir is the directory name for Stigmer config
	ConfigDir = ".stigmer"
	// ConfigFileName is the name of the config file
	ConfigFileName = "config.yaml"
	// DefaultDataDir is the default directory for local backend data
	DefaultDataDir = "data"
)

// BackendType represents the type of backend (dev or cloud)
type BackendType string

const (
	BackendTypeDev   BackendType = "dev"
	BackendTypeCloud BackendType = "cloud"
)

// Config represents the Stigmer CLI configuration
//
// This config supports both dev and cloud backends, inspired by Pulumi's approach.
// The active backend determines where resources are stored and managed.
//
// Dev mode: Resources stored in BadgerDB at ~/.stigmer/data
// Cloud mode: Resources managed via Stigmer Cloud gRPC API
type Config struct {
	Backend BackendConfig `yaml:"backend"`
	Context ContextConfig `yaml:"context,omitempty"`
}

// BackendConfig represents backend configuration
type BackendConfig struct {
	Type BackendType      `yaml:"type"` // "dev" or "cloud"
	Dev  *DevBackendConfig `yaml:"dev,omitempty"`
	Cloud *CloudBackendConfig `yaml:"cloud,omitempty"`
}

// DevBackendConfig represents dev backend configuration
type DevBackendConfig struct {
	Endpoint string          `yaml:"endpoint"`           // Daemon endpoint (default: localhost:50051)
	DataDir  string          `yaml:"data_dir"`           // Path to daemon data directory (for init)
	LLM      *LLMConfig      `yaml:"llm,omitempty"`      // LLM configuration
	Temporal *TemporalConfig `yaml:"temporal,omitempty"` // Temporal configuration
}

// LLMConfig represents LLM provider configuration
type LLMConfig struct {
	Provider string `yaml:"provider"`           // "ollama", "anthropic", "openai"
	Model    string `yaml:"model,omitempty"`    // Model name (e.g., "qwen2.5-coder:7b", "claude-sonnet-4.5")
	BaseURL  string `yaml:"base_url,omitempty"` // Base URL for API (e.g., "http://localhost:11434")
}

// TemporalConfig represents Temporal runtime configuration
type TemporalConfig struct {
	Managed bool   `yaml:"managed"`           // true = auto-download/start, false = external
	Version string `yaml:"version,omitempty"` // Version for managed binary (e.g., "1.25.1")
	Port    int    `yaml:"port,omitempty"`    // Port for managed Temporal (default: 7233)
	Address string `yaml:"address,omitempty"` // Address for external Temporal
}

// CloudBackendConfig represents cloud backend configuration
type CloudBackendConfig struct {
	Endpoint string `yaml:"endpoint"`           // gRPC endpoint (default: api.stigmer.ai:443)
	Token    string `yaml:"token,omitempty"`    // Auth token
	OrgID    string `yaml:"org_id,omitempty"`   // Organization ID
	EnvID    string `yaml:"env_id,omitempty"`   // Environment ID
}

// ContextConfig represents CLI context (only used in cloud mode)
type ContextConfig struct {
	Organization string `yaml:"organization,omitempty"` // Organization name/ID
	Environment  string `yaml:"environment,omitempty"`  // Environment name/ID
}

// Load reads the config file from ~/.stigmer/config.yaml
//
// If the config file doesn't exist, returns a default config with local backend.
func Load() (*Config, error) {
	configPath, err := GetConfigPath()
	if err != nil {
		return nil, errors.Wrap(err, "failed to get config path")
	}

	if !fileExists(configPath) {
		return GetDefault(), nil
	}

	configBytes, err := os.ReadFile(configPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read config file at %s", configPath)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(configBytes, cfg); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal config YAML")
	}

	return cfg, nil
}

// Save writes the config to ~/.stigmer/config.yaml
func Save(cfg *Config) error {
	configBytes, err := yaml.Marshal(cfg)
	if err != nil {
		return errors.Wrap(err, "failed to marshal config to YAML")
	}

	configPath, err := GetConfigPath()
	if err != nil {
		return errors.Wrap(err, "failed to get config path")
	}

	// Ensure config directory exists
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create config directory")
	}

	// Write config file with restricted permissions
	if err := os.WriteFile(configPath, configBytes, 0600); err != nil {
		return errors.Wrap(err, "failed to write config file")
	}

	return nil
}

// GetDefault returns the default configuration
//
// Default is dev backend connecting to localhost:50051 daemon
// with Ollama LLM and managed Temporal runtime (zero-config)
func GetDefault() *Config {
	dataDir, _ := GetDataDir()
	return &Config{
		Backend: BackendConfig{
			Type: BackendTypeDev,
			Dev: &DevBackendConfig{
				Endpoint: "localhost:50051", // ADR 011: daemon port
				DataDir:  dataDir,
				LLM: &LLMConfig{
					Provider: "ollama",
					Model:    "qwen2.5-coder:7b",
					BaseURL:  "http://localhost:11434",
				},
				Temporal: &TemporalConfig{
					Managed: true,
					Version: "1.25.1",
					Port:    7233,
				},
			},
		},
	}
}

// GetConfigPath returns the full path to the config file (~/.stigmer/config.yaml)
func GetConfigPath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to get user home directory")
	}
	return filepath.Join(homeDir, ConfigDir, ConfigFileName), nil
}

// GetConfigDir returns the config directory path (~/.stigmer)
func GetConfigDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to get user home directory")
	}
	return filepath.Join(homeDir, ConfigDir), nil
}

// GetDataDir returns the default data directory path (~/.stigmer/data)
func GetDataDir() (string, error) {
	configDir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, DefaultDataDir), nil
}

// IsInitialized checks if the CLI is initialized (config file exists)
func IsInitialized() bool {
	configPath, err := GetConfigPath()
	if err != nil {
		return false
	}
	return fileExists(configPath)
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ResolveLLMProvider resolves the LLM provider with cascading config
// Priority: env var > config file > default
func (c *DevBackendConfig) ResolveLLMProvider() string {
	// 1. Check environment variable
	if provider := os.Getenv("STIGMER_LLM_PROVIDER"); provider != "" {
		return provider
	}
	
	// 2. Check config file
	if c.LLM != nil && c.LLM.Provider != "" {
		return c.LLM.Provider
	}
	
	// 3. Default
	return "ollama"
}

// ResolveLLMModel resolves the LLM model with cascading config
func (c *DevBackendConfig) ResolveLLMModel() string {
	// 1. Check environment variable
	if model := os.Getenv("STIGMER_LLM_MODEL"); model != "" {
		return model
	}
	
	// 2. Check config file
	if c.LLM != nil && c.LLM.Model != "" {
		return c.LLM.Model
	}
	
	// 3. Provider-specific defaults
	provider := c.ResolveLLMProvider()
	switch provider {
	case "ollama":
		return "qwen2.5-coder:7b"
	case "anthropic":
		return "claude-sonnet-4.5"
	case "openai":
		return "gpt-4"
	default:
		return "qwen2.5-coder:7b"
	}
}

// ResolveLLMBaseURL resolves the LLM base URL with cascading config
func (c *DevBackendConfig) ResolveLLMBaseURL() string {
	// 1. Check environment variable
	if baseURL := os.Getenv("STIGMER_LLM_BASE_URL"); baseURL != "" {
		return baseURL
	}
	
	// 2. Check config file
	if c.LLM != nil && c.LLM.BaseURL != "" {
		return c.LLM.BaseURL
	}
	
	// 3. Provider-specific defaults
	provider := c.ResolveLLMProvider()
	switch provider {
	case "ollama":
		return "http://localhost:11434"
	case "anthropic":
		return "https://api.anthropic.com"
	case "openai":
		return "https://api.openai.com/v1"
	default:
		return "http://localhost:11434"
	}
}

// ResolveTemporalAddress resolves the Temporal service address
// Returns (address, isManaged)
func (c *DevBackendConfig) ResolveTemporalAddress() (string, bool) {
	// 1. Check environment variable (forces external mode)
	if addr := os.Getenv("TEMPORAL_SERVICE_ADDRESS"); addr != "" {
		return addr, false // external
	}
	
	// 2. Check config: managed vs external
	if c.Temporal != nil {
		if c.Temporal.Managed {
			port := c.Temporal.Port
			if port == 0 {
				port = 7233
			}
			return fmt.Sprintf("localhost:%d", port), true // managed
		} else if c.Temporal.Address != "" {
			return c.Temporal.Address, false // external
		}
	}
	
	// 3. Default: managed Temporal
	return "localhost:7233", true
}

// ResolveTemporalVersion resolves the Temporal version for managed runtime
func (c *DevBackendConfig) ResolveTemporalVersion() string {
	if c.Temporal != nil && c.Temporal.Version != "" {
		return c.Temporal.Version
	}
	return "1.25.1" // default version
}

// ResolveTemporalPort resolves the Temporal port for managed runtime
func (c *DevBackendConfig) ResolveTemporalPort() int {
	if c.Temporal != nil && c.Temporal.Port != 0 {
		return c.Temporal.Port
	}
	return 7233 // default port
}

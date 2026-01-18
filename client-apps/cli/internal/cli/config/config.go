package config

import (
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

// BackendType represents the type of backend (local or cloud)
type BackendType string

const (
	BackendTypeLocal BackendType = "local"
	BackendTypeCloud BackendType = "cloud"
)

// Config represents the Stigmer CLI configuration
//
// This config supports both local and cloud backends, inspired by Pulumi's approach.
// The active backend determines where resources are stored and managed.
//
// Local mode: Resources stored in BadgerDB at ~/.stigmer/data
// Cloud mode: Resources managed via Stigmer Cloud gRPC API
type Config struct {
	Backend BackendConfig `yaml:"backend"`
	Context ContextConfig `yaml:"context,omitempty"`
}

// BackendConfig represents backend configuration
type BackendConfig struct {
	Type  BackendType        `yaml:"type"` // "local" or "cloud"
	Local *LocalBackendConfig `yaml:"local,omitempty"`
	Cloud *CloudBackendConfig `yaml:"cloud,omitempty"`
}

// LocalBackendConfig represents local backend configuration
type LocalBackendConfig struct {
	Endpoint string `yaml:"endpoint"` // Daemon endpoint (default: localhost:50051)
	DataDir  string `yaml:"data_dir"` // Path to daemon data directory (for init)
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
// Default is local backend connecting to localhost:50051 daemon
func GetDefault() *Config {
	dataDir, _ := GetDataDir()
	return &Config{
		Backend: BackendConfig{
			Type: BackendTypeLocal,
			Local: &LocalBackendConfig{
				Endpoint: "localhost:50051", // ADR 011: daemon port
				DataDir:  dataDir,
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

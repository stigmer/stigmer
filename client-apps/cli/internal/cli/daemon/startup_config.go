package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
)

const startupConfigFileName = "startup-config.json"

// StartupConfig stores configuration needed to restart daemon components.
type StartupConfig struct {
	DataDir      string `json:"data_dir"`
	LogDir       string `json:"log_dir"`
	TemporalAddr string `json:"temporal_addr"`

	LLMProvider string `json:"llm_provider"`
	LLMModel    string `json:"llm_model"`
	LLMBaseURL  string `json:"llm_base_url"`

	ExecutionMode   string `json:"execution_mode"`
	SandboxImage    string `json:"sandbox_image"`
	SandboxAutoPull bool   `json:"sandbox_auto_pull"`
	SandboxCleanup  bool   `json:"sandbox_cleanup"`
	SandboxTTL      int    `json:"sandbox_ttl"`

	StigmerServerPID int `json:"stigmer_server_pid"`

	// ServerOnly indicates the daemon was started in server-only mode
	// (control plane only, no runners).
	ServerOnly bool `json:"server_only"`
}

func saveStartupConfig(config *StartupConfig) error {
	configPath := filepath.Join(config.DataDir, startupConfigFileName)

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal startup config")
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return errors.Wrap(err, "failed to write startup config")
	}

	return nil
}

func loadStartupConfig(dataDir string) (*StartupConfig, error) {
	configPath := filepath.Join(dataDir, startupConfigFileName)

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read startup config")
	}

	var config StartupConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal startup config")
	}

	return &config, nil
}

func removeStartupConfig(dataDir string) {
	configPath := filepath.Join(dataDir, startupConfigFileName)
	_ = os.Remove(configPath)
}

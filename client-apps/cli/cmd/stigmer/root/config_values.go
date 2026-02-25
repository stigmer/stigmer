package root

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// getConfigValue reads a value from the config by dot-notation key.
func getConfigValue(cfg *config.Config, key string) (string, error) {
	parts := strings.Split(key, ".")

	switch {
	case key == "backend.type":
		return string(cfg.Backend.Type), nil

	case len(parts) >= 2 && parts[0] == "llm" && cfg.Backend.Local != nil && cfg.Backend.Local.LLM != nil:
		llm := cfg.Backend.Local.LLM
		switch parts[1] {
		case "provider":
			return llm.Provider, nil
		case "model":
			return llm.Model, nil
		case "base_url":
			return llm.BaseURL, nil
		}

	case len(parts) >= 2 && parts[0] == "temporal" && cfg.Backend.Local != nil && cfg.Backend.Local.Temporal != nil:
		temporal := cfg.Backend.Local.Temporal
		switch parts[1] {
		case "managed":
			return strconv.FormatBool(temporal.Managed), nil
		}

	case len(parts) >= 2 && parts[0] == "execution" && cfg.Backend.Local != nil && cfg.Backend.Local.Execution != nil:
		execution := cfg.Backend.Local.Execution
		switch parts[1] {
		case "mode":
			return execution.Mode, nil
		case "sandbox_image":
			return execution.SandboxImage, nil
		case "auto_pull":
			return strconv.FormatBool(execution.AutoPull), nil
		case "cleanup":
			return strconv.FormatBool(execution.Cleanup), nil
		case "ttl":
			return strconv.Itoa(execution.TTL), nil
		}
	}

	return "", fmt.Errorf("unknown configuration key: %s", key)
}

// setConfigValue writes a value to the config by dot-notation key.
func setConfigValue(cfg *config.Config, key, value string) error {
	parts := strings.Split(key, ".")

	if cfg.Backend.Local == nil {
		cfg.Backend.Local = &config.LocalBackendConfig{}
	}

	switch {
	case key == "backend.type":
		cfg.Backend.Type = config.BackendType(value)
		return nil

	case len(parts) >= 2 && parts[0] == "llm":
		if cfg.Backend.Local.LLM == nil {
			cfg.Backend.Local.LLM = &config.LLMConfig{}
		}
		llm := cfg.Backend.Local.LLM
		switch parts[1] {
		case "provider":
			llm.Provider = value
			return nil
		case "model":
			llm.Model = value
			return nil
		case "base_url":
			llm.BaseURL = value
			return nil
		}

	case len(parts) >= 2 && parts[0] == "temporal":
		if cfg.Backend.Local.Temporal == nil {
			cfg.Backend.Local.Temporal = &config.TemporalConfig{}
		}
		temporal := cfg.Backend.Local.Temporal
		switch parts[1] {
		case "managed":
			boolValue, err := strconv.ParseBool(value)
			if err != nil {
				return fmt.Errorf("invalid boolean value for %s: %s", key, value)
			}
			temporal.Managed = boolValue
			return nil
		}

	case len(parts) >= 2 && parts[0] == "execution":
		if cfg.Backend.Local.Execution == nil {
			cfg.Backend.Local.Execution = &config.ExecutionConfig{}
		}
		execution := cfg.Backend.Local.Execution
		switch parts[1] {
		case "mode":
			if value != "local" && value != "sandbox" && value != "auto" {
				return fmt.Errorf("invalid execution mode: %s (must be: local, sandbox, or auto)", value)
			}
			execution.Mode = value
			return nil
		case "sandbox_image":
			execution.SandboxImage = value
			return nil
		case "auto_pull":
			boolValue, err := strconv.ParseBool(value)
			if err != nil {
				return fmt.Errorf("invalid boolean value for %s: %s", key, value)
			}
			execution.AutoPull = boolValue
			return nil
		case "cleanup":
			boolValue, err := strconv.ParseBool(value)
			if err != nil {
				return fmt.Errorf("invalid boolean value for %s: %s", key, value)
			}
			execution.Cleanup = boolValue
			return nil
		case "ttl":
			intValue, err := strconv.Atoi(value)
			if err != nil {
				return fmt.Errorf("invalid integer value for %s: %s", key, value)
			}
			execution.TTL = intValue
			return nil
		}
	}

	return fmt.Errorf("unknown configuration key: %s", key)
}

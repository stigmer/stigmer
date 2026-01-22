package root

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// NewConfigCommand creates the config command for managing CLI configuration
func NewConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage Stigmer CLI configuration",
		Long: `Manage Stigmer CLI configuration stored at ~/.stigmer/config.yaml

The configuration supports three levels of priority:
  1. CLI flags (highest priority)
  2. Environment variables  
  3. Config file (lowest priority)

Use these commands to manage persistent config file settings.`,
	}

	cmd.AddCommand(newConfigGetCommand())
	cmd.AddCommand(newConfigSetCommand())
	cmd.AddCommand(newConfigListCommand())
	cmd.AddCommand(newConfigPathCommand())

	return cmd
}

func newConfigGetCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "get <key>",
		Short: "Get a configuration value",
		Long: `Get a configuration value from ~/.stigmer/config.yaml

Examples:
  stigmer config get execution.mode
  stigmer config get execution.sandbox_image
  stigmer config get llm.provider`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			key := args[0]
			handleConfigGet(key)
		},
	}
}

func newConfigSetCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a configuration value",
		Long: `Set a configuration value in ~/.stigmer/config.yaml

Examples:
  stigmer config set execution.mode sandbox
  stigmer config set execution.sandbox_image my-custom:latest
  stigmer config set llm.provider anthropic`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			key := args[0]
			value := args[1]
			handleConfigSet(key, value)
		},
	}
}

func newConfigListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all configuration values",
		Long:  `List all configuration values from ~/.stigmer/config.yaml`,
		Run: func(cmd *cobra.Command, args []string) {
			handleConfigList()
		},
	}
}

func newConfigPathCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "path",
		Short: "Show configuration file path",
		Long:  `Show the path to the configuration file (~/.stigmer/config.yaml)`,
		Run: func(cmd *cobra.Command, args []string) {
			handleConfigPath()
		},
	}
}

func handleConfigGet(key string) {
	cfg, err := config.Load()
	if err != nil {
		cliprint.PrintError("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	value, err := getConfigValue(cfg, key)
	if err != nil {
		cliprint.PrintError("Configuration key not found: %s", key)
		cliprint.PrintInfo("Use 'stigmer config list' to see available keys")
		return
	}

	fmt.Println(value)
}

func handleConfigSet(key, value string) {
	cfg, err := config.Load()
	if err != nil {
		cliprint.PrintError("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	if err := setConfigValue(cfg, key, value); err != nil {
		cliprint.PrintError("Failed to set configuration: %v", err)
		cliprint.PrintInfo("Use 'stigmer config list' to see available keys")
		return
	}

	if err := config.Save(cfg); err != nil {
		cliprint.PrintError("Failed to save configuration")
		clierr.Handle(err)
		return
	}

	cliprint.PrintSuccess("Configuration updated: %s = %s", key, value)
	configPath, _ := config.GetConfigPath()
	cliprint.PrintInfo("Saved to: %s", configPath)
}

func handleConfigList() {
	cfg, err := config.Load()
	if err != nil {
		cliprint.PrintError("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	configPath, _ := config.GetConfigPath()
	fmt.Printf("Configuration from %s:\n\n", configPath)

	// Backend type
	fmt.Printf("backend.type = %s\n", cfg.Backend.Type)

	// Local backend config
	if cfg.Backend.Local != nil {
		local := cfg.Backend.Local

		// LLM config
		if local.LLM != nil {
			fmt.Printf("llm.provider = %s\n", local.LLM.Provider)
			fmt.Printf("llm.model = %s\n", local.LLM.Model)
			fmt.Printf("llm.base_url = %s\n", local.LLM.BaseURL)
		}

		// Temporal config
		if local.Temporal != nil {
			fmt.Printf("temporal.managed = %v\n", local.Temporal.Managed)
		}

		// Execution config
		if local.Execution != nil {
			fmt.Printf("execution.mode = %s\n", local.Execution.Mode)
			fmt.Printf("execution.sandbox_image = %s\n", local.Execution.SandboxImage)
			fmt.Printf("execution.auto_pull = %v\n", local.Execution.AutoPull)
			fmt.Printf("execution.cleanup = %v\n", local.Execution.Cleanup)
			fmt.Printf("execution.ttl = %d\n", local.Execution.TTL)
		}
	}

	fmt.Println()
	cliprint.PrintInfo("Edit directly: %s", configPath)
	cliprint.PrintInfo("Or use: stigmer config set <key> <value>")
}

func handleConfigPath() {
	configPath, err := config.GetConfigPath()
	if err != nil {
		cliprint.PrintError("Failed to get configuration path")
		clierr.Handle(err)
		return
	}

	fmt.Println(configPath)
}

// getConfigValue gets a value from the config by dot-notation key
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

// setConfigValue sets a value in the config by dot-notation key
func setConfigValue(cfg *config.Config, key, value string) error {
	parts := strings.Split(key, ".")

	// Ensure local backend config exists
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
			// Validate mode
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

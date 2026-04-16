package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewConfigCommand creates the config command for managing CLI configuration
func NewConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage Stigmer CLI configuration",
		Long: `Manage Stigmer CLI configuration stored at ~/.stigmer/config.yaml

Includes backend selection (local vs cloud), organization context,
and key-value settings for execution, LLM, and Temporal.

The configuration supports three levels of priority:
  1. CLI flags (highest priority)
  2. Environment variables
  3. Config file (lowest priority)`,
	}

	cmd.AddCommand(NewBackendCommand())
	cmd.AddCommand(NewContextCommand())
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
		Long: `Get a configuration value from ~/.stigmer/config.yaml`,
		Example: `  # Get the current execution mode
  stigmer config get execution.mode

  # Get the LLM provider
  stigmer config get llm.provider

  # Get the sandbox image
  stigmer config get execution.sandbox_image`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			key := args[0]
			handleConfigGet(key)
		},
	}
}

func newConfigSetCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a configuration value",
		Long: `Set a configuration value in ~/.stigmer/config.yaml`,
		Example: `  # Set execution mode to sandbox
  stigmer config set execution.mode sandbox

  # Set a custom sandbox image
  stigmer config set execution.sandbox_image my-custom:latest

  # Set the LLM provider
  stigmer config set llm.provider anthropic`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			key := args[0]
			value := args[1]
			handleConfigSet(key, value, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newConfigListCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List all configuration values",
		Long:    `List all configuration values from ~/.stigmer/config.yaml`,
		Example: `  stigmer config list`,
		Run: func(cmd *cobra.Command, args []string) {
			handleConfigList(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newConfigPathCommand() *cobra.Command {
	return &cobra.Command{
		Use:     "path",
		Short:   "Show configuration file path",
		Long:    `Show the path to the configuration file (~/.stigmer/config.yaml)`,
		Example: `  stigmer config path`,
		Run: func(cmd *cobra.Command, args []string) {
			handleConfigPath()
		},
	}
}

func handleConfigGet(key string) {
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	value, err := getConfigValue(cfg, key)
	if err != nil {
		result := clioutput.Error("Configuration key not found: %s", key)
		result.Hint("Use 'stigmer config list' to see available keys")
		renderer.Render(result)
		return
	}

	fmt.Println(value)
}

func handleConfigSet(key, value string, format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	if err := setConfigValue(cfg, key, value); err != nil {
		result := clioutput.Error("Failed to set configuration: %v", err)
		result.Hint("Use 'stigmer config list' to see available keys")
		renderer.Render(result)
		return
	}

	if err := config.Save(cfg); err != nil {
		clierr.Handle(err)
		return
	}

	configPath, _ := config.GetConfigPath()
	result := clioutput.Success("Configuration updated: %s = %s", key, value)
	result.Hintf("Saved to: %s", configPath)
	renderer.Render(result)
}

func handleConfigList(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	configPath, _ := config.GetConfigPath()

	result := clioutput.Success("Configuration from %s", configPath)
	result.AddSection("Backend").
		Field("backend.type", string(cfg.Backend.Type))

	if cfg.Backend.Local != nil {
		local := cfg.Backend.Local

		if local.LLM != nil {
			result.AddSection("LLM").
				Field("llm.provider", local.LLM.Provider).
				Field("llm.model", local.LLM.Model).
				Field("llm.base_url", local.LLM.BaseURL)
		}

		if local.Temporal != nil {
			result.AddSection("Temporal").
				Fieldf("temporal.managed", "%v", local.Temporal.Managed)
		}

		if local.Execution != nil {
			result.AddSection("Execution").
				Field("execution.mode", local.Execution.Mode).
				Field("execution.sandbox_image", local.Execution.SandboxImage).
				Fieldf("execution.auto_pull", "%v", local.Execution.AutoPull).
				Fieldf("execution.cleanup", "%v", local.Execution.Cleanup).
				Fieldf("execution.ttl", "%d", local.Execution.TTL)
		}
	}

	result.Hintf("Edit directly: %s", configPath)
	result.Hint("Or use: stigmer config set <key> <value>")
	renderer.Render(result)
}

func handleConfigPath() {
	configPath, err := config.GetConfigPath()
	if err != nil {
		clierr.Handle(err)
		return
	}

	fmt.Println(configPath)
}

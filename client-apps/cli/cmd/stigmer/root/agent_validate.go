package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// newAgentValidateCommand creates the agent validate subcommand.
func newAgentValidateCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "validate [file]",
		Short: "Validate an agent configuration",
		Long: `Validate an agent configuration from a YAML or JSON file.

This command loads and validates the agent configuration without applying
it to the backend. It's useful for CI/CD pipelines and pre-commit checks.

If no file is specified, the command looks for 'agent.yaml' or 
'AGENT.yaml' in the current directory.

The validation checks:
  - YAML/JSON syntax
  - Proto schema conformance (apiVersion, kind, metadata, spec)
  - Cross-field business logic (unique MCP servers, valid references)

Exit codes:
  0 - Configuration is valid
  1 - Configuration is invalid or file not found`,
		Example: `  # Validate from a specific file
  stigmer agent validate agent.yaml

  # Validate from current directory (auto-detect agent.yaml)
  stigmer agent validate

  # Validate in CI pipeline
  stigmer agent validate agent.yaml && echo "Valid"`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			var filePath string
			if len(args) > 0 {
				filePath = args[0]
			}

			err := executeAgentValidate(filePath)
			clierr.Handle(err)

			// If we get here, validation succeeded
			cliprint.PrintSuccess("Agent configuration is valid")
		},
	}

	return cmd
}

// executeAgentValidate handles the agent validation logic.
func executeAgentValidate(filePath string) error {
	// Step 1: Load the configuration file
	loadResult, err := agent.Load(&agent.LoadOptions{
		FilePath: filePath,
	})
	if err != nil {
		return err
	}

	cliprint.PrintInfo("Validating: %s", loadResult.SourcePath)
	fmt.Println()

	// Step 2: Validate cross-field logic
	if err := agent.Validate(loadResult.Agent); err != nil {
		return err
	}

	return nil
}

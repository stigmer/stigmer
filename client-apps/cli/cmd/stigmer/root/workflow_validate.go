package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// newWorkflowValidateCommand creates the workflow validate subcommand.
func newWorkflowValidateCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "validate <file>",
		Short: "Validate a workflow configuration",
		Long: `Validate a workflow configuration from a YAML or JSON file.

This command loads and validates the workflow configuration without applying
it to the backend. It's useful for CI/CD pipelines and pre-commit checks.

The validation checks:
  - YAML/JSON syntax
  - Proto schema conformance (apiVersion, kind, metadata, spec)
  - Task name uniqueness (no duplicates)
  - Flow control references (flow.then must reference existing task or "end")
  - DAG acyclicity (no circular dependencies in flow)

Exit codes:
  0 - Configuration is valid
  1 - Configuration is invalid or file not found`,
		Example: `  # Validate a workflow file
  stigmer workflow validate workflow.yaml

  # Validate in CI pipeline
  stigmer workflow validate workflow.yaml && echo "Valid"

  # Validate with the 'wf' alias
  stigmer wf validate workflow.yaml`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeWorkflowValidate(args[0])
			clierr.Handle(err)

			// If we get here, validation succeeded
			cliprint.PrintSuccess("Workflow configuration is valid")
		},
	}

	return cmd
}

// executeWorkflowValidate handles the workflow validation logic.
func executeWorkflowValidate(filePath string) error {
	// Step 1: Load the configuration file
	loadResult, err := workflow.Load(&workflow.LoadOptions{
		FilePath: filePath,
	})
	if err != nil {
		return err
	}

	cliprint.PrintInfo("Validating: %s", loadResult.SourcePath)
	fmt.Println()

	// Step 2: Validate cross-field logic
	if err := workflow.Validate(loadResult.Workflow); err != nil {
		return err
	}

	return nil
}

package root

import (
	"fmt"

	"github.com/spf13/cobra"
)

// NewWorkflowCommand creates a deprecated workflow command group.
// All workflow commands have been migrated to verb-first pattern.
func NewWorkflowCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:        "workflow",
		Aliases:    []string{"wf"},
		Short:      "[DEPRECATED] Use verb-first commands instead",
		Deprecated: "All workflow commands have been migrated to verb-first pattern.",
		Long: `DEPRECATED: All workflow commands have been migrated to verb-first pattern.

Use these commands instead:

  stigmer apply -f workflow.yaml      # Apply/create workflow from file
  stigmer get workflow <name>         # Get workflow details
  stigmer list workflows              # List all workflows
  stigmer delete workflow <name>      # Delete a workflow
  stigmer validate -f workflow.yaml   # Validate workflow manifest
  stigmer run workflow <name>         # Execute a workflow
  stigmer search workflows <query>    # Search for workflows

The verb-first pattern provides consistency across all resource types
and better discoverability.`,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println()
			fmt.Println("DEPRECATED: All workflow commands have been migrated to verb-first pattern.")
			fmt.Println()
			fmt.Println("Use these commands instead:")
			fmt.Println("  stigmer apply -f workflow.yaml      # Apply/create workflow from file")
			fmt.Println("  stigmer get workflow <name>         # Get workflow details")
			fmt.Println("  stigmer list workflows              # List all workflows")
			fmt.Println("  stigmer delete workflow <name>      # Delete a workflow")
			fmt.Println("  stigmer validate -f workflow.yaml   # Validate workflow manifest")
			fmt.Println("  stigmer run workflow <name>         # Execute a workflow")
			fmt.Println("  stigmer search workflows <query>    # Search for workflows")
			fmt.Println()
		},
	}

	return cmd
}

package root

import (
	"fmt"

	"github.com/spf13/cobra"
)

// NewAgentCommand creates a deprecated agent command group.
// All agent commands have been migrated to verb-first pattern.
func NewAgentCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:        "agent",
		Aliases:    []string{"agt"},
		Short:      "[DEPRECATED] Use verb-first commands instead",
		Deprecated: "All agent commands have been migrated to verb-first pattern.",
		Long: `DEPRECATED: All agent commands have been migrated to verb-first pattern.

Use these commands instead:

  stigmer apply -f agent.yaml      # Apply/create agent from file
  stigmer get agent <name>         # Get agent details
  stigmer list agents              # List all agents
  stigmer delete agent <name>      # Delete an agent
  stigmer validate -f agent.yaml   # Validate agent manifest
  stigmer run agent <name>         # Execute an agent
  stigmer search agents <query>    # Search for agents

The verb-first pattern provides consistency across all resource types
and better discoverability.`,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println()
			fmt.Println("DEPRECATED: All agent commands have been migrated to verb-first pattern.")
			fmt.Println()
			fmt.Println("Use these commands instead:")
			fmt.Println("  stigmer apply -f agent.yaml      # Apply/create agent from file")
			fmt.Println("  stigmer get agent <name>         # Get agent details")
			fmt.Println("  stigmer list agents              # List all agents")
			fmt.Println("  stigmer delete agent <name>      # Delete an agent")
			fmt.Println("  stigmer validate -f agent.yaml   # Validate agent manifest")
			fmt.Println("  stigmer run agent <name>         # Execute an agent")
			fmt.Println("  stigmer search agents <query>    # Search for agents")
			fmt.Println()
		},
	}

	return cmd
}

package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// newAgentListCommand creates the agent list subcommand.
func newAgentListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List agents",
		Long: `List agents in the current organization.

Note: List operation is not yet fully implemented. Use 'stigmer agent get <name>'
to retrieve a specific agent by name or ID.`,
		Example: `  # List agents (placeholder)
  stigmer agent list

  # To retrieve a specific agent, use:
  stigmer agent get my-agent`,
		Run: func(cmd *cobra.Command, args []string) {
			executeAgentList()
		},
	}

	return cmd
}

// executeAgentList handles the agent list operation.
// Currently displays a placeholder message since the List API is not yet available.
func executeAgentList() {
	fmt.Println()
	cliprint.PrintWarning("List operation is not yet supported.")
	fmt.Println()
	cliprint.PrintInfo("To retrieve a specific agent, use:")
	cliprint.PrintInfo("  stigmer agent get <name>")
	fmt.Println()
	cliprint.PrintInfo("Examples:")
	cliprint.PrintInfo("  stigmer agent get my-agent")
	cliprint.PrintInfo("  stigmer agent get stigmer/code-reviewer")
	cliprint.PrintInfo("  stigmer agent get agt_abc123")
	fmt.Println()
}

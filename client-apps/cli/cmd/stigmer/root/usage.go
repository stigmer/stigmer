package root

import (
	"github.com/spf13/cobra"
)

// NewUsageCommand creates the usage command for viewing cost and usage reports.
//
// This is a parent command with three subcommands:
//   - session: usage report for a single session
//   - agent:   usage report for an agent across sessions
//   - org:     usage report for an entire organization
func NewUsageCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "usage",
		Short: "View usage and cost reports",
		Long: `View token usage, cost, and model breakdown reports.

Reports are available at three levels of granularity:

  session   Per-execution breakdown within a single session
  agent     Aggregate across all sessions for an agent
  org       Aggregate across all agents in an organization

All cost data is computed at execution time using the pricing rates in effect
when the execution ran. Historical reports are always accurate regardless of
pricing changes.`,
		Example: `  # View usage for a specific session
  stigmer usage session ses_abc123

  # View usage for an agent over a date range
  stigmer usage agent my-coding-assistant --from 2026-03-01 --to 2026-03-13

  # View organization-wide usage
  stigmer usage org --from 2026-03-01 --to 2026-03-31`,
	}

	cmd.AddCommand(newUsageSessionCommand())
	cmd.AddCommand(newUsageAgentCommand())
	cmd.AddCommand(newUsageOrgCommand())

	return cmd
}

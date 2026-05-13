package root

import (
	"github.com/spf13/cobra"
)

// NewExecutionCommand creates the execution command group for lifecycle
// management and observability of both agent and workflow executions.
func NewExecutionCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "execution",
		Short: "Manage execution lifecycle and observability",
		Long: `Manage the lifecycle of agent and workflow executions.

The execution type (agent vs workflow) is auto-detected from the ID prefix:
  - Agent executions:    aex_<ulid>
  - Workflow executions: wex_<ulid>

LIFECYCLE:
  cancel       Gracefully cancel a running execution
  terminate    Force-stop an execution immediately
  pause        Pause a running execution
  resume       Resume a paused execution

OBSERVABILITY:
  logs         Stream or view execution event logs
  trace        Show execution task structure and timing

APPROVAL:
  approve      Submit approval for a waiting execution`,
		Example: `  # Cancel a workflow execution
  stigmer execution cancel wex_01abc123

  # Pause an agent execution with a reason
  stigmer execution pause aex_01xyz789 --reason "investigating issue"

  # Stream live logs from a workflow execution
  stigmer execution logs wex_01abc123 --follow

  # Show execution trace
  stigmer execution trace wex_01abc123

  # Approve a waiting task
  stigmer execution approve wex_01abc123 --task review --outcome approve`,
	}

	cmd.AddCommand(newExecutionCancelCommand())
	cmd.AddCommand(newExecutionTerminateCommand())
	cmd.AddCommand(newExecutionPauseCommand())
	cmd.AddCommand(newExecutionResumeCommand())
	cmd.AddCommand(newExecutionLogsCommand())
	cmd.AddCommand(newExecutionTraceCommand())
	cmd.AddCommand(newExecutionApproveCommand())

	return cmd
}

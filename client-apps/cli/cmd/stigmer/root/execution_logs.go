package root

import (
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
)

func newExecutionLogsCommand() *cobra.Command {
	var follow bool
	var taskFilter string

	cmd := &cobra.Command{
		Use:   "logs <execution-id>",
		Short: "View execution event logs",
		Long: `View event logs for an agent or workflow execution.

By default shows recent events. Use --follow to stream live events.
For workflow executions, use --task to filter events by task name.`,
		Example: `  # Show recent events
  stigmer execution logs wex_01abc123

  # Stream live events
  stigmer execution logs wex_01abc123 --follow

  # Filter by task name
  stigmer execution logs wex_01abc123 --task validate_email

  # Stream agent execution messages
  stigmer execution logs aex_01xyz789 --follow`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(runExecutionLogs(args[0], follow, taskFilter))
		},
	}

	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "stream live events")
	cmd.Flags().StringVar(&taskFilter, "task", "", "filter events by task name (workflow only)")

	return cmd
}

func runExecutionLogs(executionID string, follow bool, taskFilter string) error {
	execType, err := execution.ResolveType(executionID)
	if err != nil {
		return err
	}

	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	switch execType {
	case execution.ExecutionTypeWorkflow:
		return execution.WorkflowLogs(&execution.WorkflowLogsOptions{
			ExecutionID: executionID,
			Follow:      follow,
			TaskFilter:  taskFilter,
			Client:      client,
		})

	case execution.ExecutionTypeAgent:
		return execution.AgentLogs(&execution.AgentLogsOptions{
			ExecutionID: executionID,
			Follow:      follow,
			Client:      client,
		})
	}

	return nil
}

package root

import (
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
)

func newExecutionTraceCommand() *cobra.Command {
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "trace <execution-id>",
		Short: "Show execution task structure and timing",
		Long: `Show the execution structure as a task tree with status and timing.

For workflow executions: shows task DAG with status, timing, and errors.
For agent executions: shows tool call timeline.

Use --output yaml|json for structured data output.`,
		Example: `  # Show workflow execution trace
  stigmer execution trace wex_01abc123

  # Show agent execution trace
  stigmer execution trace aex_01xyz789

  # Output as YAML
  stigmer execution trace wex_01abc123 -o yaml`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(runExecutionTrace(args[0], outputFormat))
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")

	return cmd
}

func runExecutionTrace(executionID, outputFormat string) error {
	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	return execution.Trace(&execution.TraceOptions{
		ExecutionID:  executionID,
		OutputFormat: outputFormat,
		Client:       client,
	})
}

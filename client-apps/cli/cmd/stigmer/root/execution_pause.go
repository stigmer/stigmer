package root

import (
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

func newExecutionPauseCommand() *cobra.Command {
	var reason string

	cmd := &cobra.Command{
		Use:   "pause <execution-id>",
		Short: "Pause a running execution",
		Long: `Pause a running agent or workflow execution.

A paused execution can be resumed later with 'stigmer execution resume'.
Running activities are gracefully stopped and checkpoints are saved.`,
		Example: `  stigmer execution pause aex_01abc123
  stigmer execution pause wex_01xyz789 --reason "waiting for review"`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(executePauseExecution(args[0], reason))
		},
	}

	cmd.Flags().StringVar(&reason, "reason", "", "reason for pausing")

	return cmd
}

func executePauseExecution(executionID, reason string) error {
	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	phase, err := execution.Pause(&execution.PauseOptions{
		ExecutionID: executionID,
		Reason:      reason,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Execution paused: %s (phase: %s)", executionID, phase)
	return nil
}

func newExecutionResumeCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "resume <execution-id>",
		Short: "Resume a paused execution",
		Long: `Resume a previously paused agent or workflow execution.

The execution continues from its last checkpoint.`,
		Example: `  stigmer execution resume aex_01abc123
  stigmer execution resume wex_01xyz789`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(executeResumeExecution(args[0]))
		},
	}

	return cmd
}

func executeResumeExecution(executionID string) error {
	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	phase, err := execution.Resume(&execution.ResumeOptions{
		ExecutionID: executionID,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Execution resumed: %s (phase: %s)", executionID, phase)
	return nil
}

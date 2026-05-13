package root

import (
	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

func newExecutionCancelCommand() *cobra.Command {
	var reason string

	cmd := &cobra.Command{
		Use:   "cancel <execution-id>",
		Short: "Gracefully cancel a running execution",
		Long: `Cancel a running agent or workflow execution gracefully.

The execution type is auto-detected from the ID prefix (aex_ or wex_).
A cancelled execution will stop at its next safe point and transition
to the "cancelled" phase.`,
		Example: `  stigmer execution cancel aex_01abc123
  stigmer execution cancel wex_01xyz789 --reason "no longer needed"`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(runCancelExecution(args[0], reason))
		},
	}

	cmd.Flags().StringVar(&reason, "reason", "", "reason for cancellation")

	return cmd
}

func runCancelExecution(executionID, reason string) error {
	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	phase, err := execution.Cancel(&execution.CancelOptions{
		ExecutionID: executionID,
		Reason:      reason,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Execution cancelled: %s (phase: %s)", executionID, phase)
	return nil
}

func newExecutionTerminateCommand() *cobra.Command {
	var reason string

	cmd := &cobra.Command{
		Use:   "terminate <execution-id>",
		Short: "Force-stop an execution immediately",
		Long: `Terminate an execution immediately without cleanup.

Unlike cancel, terminate does not wait for a safe stopping point.
The execution transitions directly to "terminated" phase.
Terminated executions cannot be recovered.`,
		Example: `  stigmer execution terminate aex_01abc123
  stigmer execution terminate wex_01xyz789 --reason "stuck execution"`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(runTerminateExecution(args[0], reason))
		},
	}

	cmd.Flags().StringVar(&reason, "reason", "", "reason for termination")

	return cmd
}

func runTerminateExecution(executionID, reason string) error {
	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	phase, err := execution.Terminate(&execution.TerminateOptions{
		ExecutionID: executionID,
		Reason:      reason,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Execution terminated: %s (phase: %s)", executionID, phase)
	return nil
}

// connectForExecution establishes a backend connection using standard CLI patterns.
func connectForExecution() (*stigmer.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, errors.Wrap(err, "failed to load configuration")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, errors.Wrap(err, "failed to start daemon")
		}
	}

	client, err := backend.NewStigmerClient()
	if err != nil {
		return nil, errors.Wrap(err, "failed to connect to backend")
	}

	return client, nil
}

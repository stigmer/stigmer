package root

import (
	"fmt"
	"os"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

func isDeleteExecutionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "execution" || normalized == "executions" || normalized == "exec"
}

// executeCancelExecution handles the special case of cancelling an execution.
// For executions, "delete" maps to "cancel" operation.
func executeCancelExecution(opts deleteOptions) error {
	if !reference.IsAgentExecutionID(opts.Reference) {
		return fmt.Errorf("invalid execution ID: %s\n\nExecutions must be referenced by ID (e.g., aex_01abc123)", opts.Reference)
	}

	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn().(*grpc.ClientConn)

	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)

	if !opts.Force {
		warn := clioutput.Warning("You are about to cancel execution: %s", opts.Reference)
		warn.Hint("This will gracefully stop the running agent.")
		renderer.Render(warn)

		confirmer := clioutput.NewInteractiveConfirmer(os.Stderr)
		confirmed, err := confirmer.Confirm("Proceed with cancellation? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := execution.CancelWithResult(conn, opts.Reference)
	if err != nil {
		return errors.Wrap(err, "failed to cancel execution")
	}

	if result.WasAlreadyCancelled {
		out := clioutput.Warning("Execution was already in terminal state")
		out.AddSection("Execution").
			Field("ID", result.Execution.GetMetadata().GetId()).
			Field("Status", execution.FormatPhase(result.Execution.GetStatus().GetPhase()))
		renderer.Render(out)
	} else {
		out := clioutput.Success("Execution cancelled successfully")
		out.AddSection("Execution").
			Field("ID", result.Execution.GetMetadata().GetId()).
			Field("Status", execution.FormatPhase(result.Execution.GetStatus().GetPhase()))
		renderer.Render(out)
	}
	return nil
}

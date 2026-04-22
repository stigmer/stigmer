package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/runner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewDownCommand creates the 'stigmer down' command for stopping services.
func NewDownCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "down",
		Short: "Stop Stigmer services",
		Long: `Stop all running Stigmer services.

Stops the daemon process and all managed components (Temporal,
stigmer-server, workflow-runner, agent-runner, web console),
and any standalone runners.

Use 'stigmer down server' to stop only the control plane.
Use 'stigmer down runner' to stop standalone runners.`,
		Example: `  # Stop all services
  stigmer down`,
		Run: func(cmd *cobra.Command, args []string) {
			handleStop(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newDownServerCommand())
	cmd.AddCommand(newDownRunnerCommand())

	return cmd
}

func newDownServerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:     "server",
		Short:   "Stop the local development stack",
		Long:    `Stop the Stigmer control plane and all managed processes (Temporal, stigmer-server).`,
		Example: `  stigmer down server`,
		Run: func(cmd *cobra.Command, args []string) {
			handleStopServer(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newDownRunnerCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "runner",
		Short: "Stop standalone runners",
		Long: `Stop standalone agent runner processes.

By default, stops all active runners. Use --name to stop a specific runner.`,
		Example: `  # Stop all runners
  stigmer down runner

  # Stop a specific runner
  stigmer down runner --name my-macbook`,
		Run: func(cmd *cobra.Command, args []string) {
			name, _ := cmd.Flags().GetString("name")
			handleStopRunner(name)
		},
	}

	cmd.Flags().String("name", "", "Name of the runner to stop (default: stop all)")

	return cmd
}

func handleStop(format clioutput.OutputFormat) {
	handleStopServer(format)

	if err := runner.StopAllRunners(); err != nil {
		clierr.Handle(err)
	}
}

func handleStopServer(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	dataDir, err := config.GetDataDir()
	if err != nil {
		clierr.Handle(err)
		return
	}

	if !daemon.IsRunning(dataDir) {
		result := clioutput.Warning("Server is not running")
		renderer.Render(result)
		return
	}

	if err := daemon.Stop(dataDir); err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Server stopped successfully")
	renderer.Render(result)
}

func handleStopRunner(name string) {
	if name != "" {
		if err := runner.StopRunner(name); err != nil {
			clierr.Handle(err)
		}
		return
	}
	if err := runner.StopAllRunners(); err != nil {
		clierr.Handle(err)
	}
}

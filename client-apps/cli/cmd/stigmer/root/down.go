package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
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
stigmer-server, runner, web console).

Use 'stigmer down server' to stop only the control plane.`,
		Example: `  # Stop all services
  stigmer down`,
		Run: func(cmd *cobra.Command, args []string) {
			handleStop(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newDownServerCommand())

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

func handleStop(format clioutput.OutputFormat) {
	handleStopServer(format)
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

package root

import (
	"context"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/runner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewUpCommand creates the 'stigmer up' command. The default (no subcommand)
// starts a runner — the cloud-first behavior. Use 'stigmer up server' to
// start the full local development stack.
func NewUpCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "up",
		Short: "Start a runner",
		Long: `Start a Stigmer agent runner connected to a backend.

By default, connects to the configured backend (cloud or local).
Use --endpoint and --token to connect to any backend without
requiring a config file (useful in CI/CD, containers, sandboxes).

Use 'stigmer up server' to start the full local development stack
(Temporal, stigmer-server, and an embedded runner).`,
		Example: `  # Start a runner (uses configured backend)
  stigmer up

  # Start a runner with explicit credentials
  stigmer up --endpoint api.stigmer.ai:443 --token sk-...

  # Start a runner with a custom name
  stigmer up --name my-macbook

  # Start a runner inside a Docker container
  stigmer up --runtime docker

  # Start the full local development stack
  stigmer up server`,
		Run: func(cmd *cobra.Command, args []string) {
			handleUpRunner(cmd, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().String("endpoint", "", "Backend gRPC endpoint (overrides config)")
	cmd.Flags().String("token", "", "API key / auth token (overrides config and env)")
	cmd.Flags().String("name", "", "Runner name (default: hostname)")
	cmd.Flags().String("org", "", "Organization slug (overrides config context)")
	cmd.Flags().String("runtime", "native", "Runner runtime: native (default) or docker")
	cmd.Flags().String("image", "", "Docker image for the agent runner (only used with --runtime docker)")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	cmd.AddCommand(newUpServerCommand())
	cmd.AddCommand(newUpRunnerCommand())

	return cmd
}

func handleUpRunner(cmd *cobra.Command, format clioutput.OutputFormat) {
	name, _ := cmd.Flags().GetString("name")
	endpoint, _ := cmd.Flags().GetString("endpoint")
	token, _ := cmd.Flags().GetString("token")
	org, _ := cmd.Flags().GetString("org")
	runtime, _ := cmd.Flags().GetString("runtime")
	image, _ := cmd.Flags().GetString("image")

	opts := runner.StartOptions{
		Name:             name,
		EndpointOverride: endpoint,
		TokenOverride:    token,
		OrgOverride:      org,
		Runtime:          runtime,
		Image:            image,
	}

	if format == clioutput.FormatJSON {
		err := runner.Ensure(context.Background(), opts, func(r *runner.EnsureResult) {
			_ = r.WriteJSON(os.Stdout)
		})
		if err != nil {
			_ = runner.WriteJSONError(os.Stdout, err, "")
			clierr.Handle(err)
		}
		return
	}

	if err := runner.Start(context.Background(), opts); err != nil {
		clierr.Handle(err)
	}
}

func newUpServerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start the full local development stack",
		Long: `Start the complete local Stigmer stack: Temporal, stigmer-server,
and an embedded agent runner. This is the quickstart command for
local development — no cloud account needed.`,
		Example: `  # Start the full local stack
  stigmer up server

  # Start with the web console open
  stigmer up server --open

  # Start in sandbox execution mode
  stigmer up server --execution-mode sandbox

  # Start without the web console
  stigmer up server --no-web`,
		Run: func(cmd *cobra.Command, args []string) {
			prepareAndStartServer(cmd, resolveResultFormat(jsonOutput, quietOutput), false)
		},
	}

	cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto (default: local)")
	cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode")
	cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
	cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers after execution")
	cmd.Flags().Int("sandbox-ttl", 3600, "Sandbox container reuse TTL in seconds")
	cmd.Flags().Bool("no-web", false, "Disable the embedded web console")
	cmd.Flags().Bool("open", false, "Open the web console in your browser after startup")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

func newUpRunnerCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "runner",
		Short: "Start a runner",
		Long: `Start a standalone Stigmer agent runner connected to a backend.

Identical to 'stigmer up' — provided for clarity when used alongside
'stigmer up server'.`,
		Example: `  # Start a runner against the configured backend
  stigmer up runner

  # Start a runner against a specific backend
  stigmer up runner --endpoint my-server:7234 --token sk-...

  # Start a runner with a custom name
  stigmer up runner --name build-machine

  # Start a runner inside a Docker container
  stigmer up runner --runtime docker

  # Use a specific Docker image
  stigmer up runner --runtime docker --image ghcr.io/stigmer/agent-runner:latest`,
		Run: func(cmd *cobra.Command, args []string) {
			handleUpRunner(cmd, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().String("endpoint", "", "Backend gRPC endpoint (overrides config)")
	cmd.Flags().String("token", "", "API key / auth token (overrides config and env)")
	cmd.Flags().String("name", "", "Runner name (default: hostname)")
	cmd.Flags().String("org", "", "Organization slug (overrides config context)")
	cmd.Flags().String("runtime", "native", "Runner runtime: native (default) or docker")
	cmd.Flags().String("image", "", "Docker image for the agent runner (only used with --runtime docker)")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

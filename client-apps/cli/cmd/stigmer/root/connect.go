package root

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
)

// NewConnectCommand creates the top-level connect command with resource-type subcommands.
func NewConnectCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "connect",
		Short: "Connect to external services and discover capabilities",
		Long: `Connect to external services and discover their capabilities.

Currently supports MCP servers: connect via stdio or HTTP, list available
tools and resource templates, and push the results to stigmer-server.`,
	}

	cmd.AddCommand(newConnectMcpServerCommand())

	return cmd
}

func newConnectMcpServerCommand() *cobra.Command {
	var (
		timeout  time.Duration
		dryRun   bool
		envFlags []string
	)

	cmd := &cobra.Command{
		Use:   "mcp-server <slug-or-id>",
		Short: "Connect to an MCP server and discover its tools",
		Long: `Connect to an MCP server, list its tools and resource templates,
and push the discovered capabilities to stigmer-server.

For stdio-based servers the CLI spawns the server process locally.
Environment variables from your current shell are passed through,
so credentials (e.g., GITHUB_TOKEN) never leave your machine.

For HTTP-based servers the CLI connects to the configured URL.

ENVIRONMENT VARIABLES:

  Use --env KEY=VALUE to pass credentials the MCP server needs. These are
  merged on top of your shell environment (--env values win on collision).
  The flag can be repeated for multiple variables.

  You can also export variables in your shell before running the command;
  --env is simply more convenient and mirrors stigmer run / stigmer draft.`,
		Example: `  # Connect by slug (uses default org)
  stigmer connect mcp-server github

  # Connect by org/slug
  stigmer connect mcp-server stigmer/mcp-server-stigmer

  # Pass required credentials via --env
  stigmer connect mcp-server planton-cloud --env PLANTON_API_KEY=pk-xxx

  # Multiple env vars
  stigmer connect mcp-server my-server --env GITHUB_TOKEN=ghp-xxx --env API_URL=https://...

  # Preview without pushing
  stigmer connect mcp-server github --dry-run

  # Custom timeout for slow-starting servers
  stigmer connect mcp-server my-server --timeout 60s`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeConnectMcpServer(connectMcpServerOptions{
				Reference:    args[0],
				OrgOverride:  GetOrgFlag(cmd),
				Timeout:      timeout,
				DryRun:       dryRun,
				EnvOverrides: envFlags,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().DurationVar(&timeout, "timeout", 30*time.Second, "timeout for MCP server connection and discovery")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "discover and display results without pushing to backend")
	cmd.Flags().StringArrayVar(&envFlags, "env", []string{}, "environment variable for the MCP server (KEY=VALUE, can be repeated)")

	return cmd
}

type connectMcpServerOptions struct {
	Reference    string
	OrgOverride  string
	Timeout      time.Duration
	DryRun       bool
	EnvOverrides []string
}

func executeConnectMcpServer(opts connectMcpServerOptions) error {
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
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

	result, err := mcpserver.Connect(context.Background(), &mcpserver.ConnectOptions{
		Client:       client,
		Cfg:          cfg,
		OrgID:        orgID,
		Ref:          opts.Reference,
		Timeout:      opts.Timeout,
		DryRun:       opts.DryRun,
		EnvOverrides: opts.EnvOverrides,
	})
	if err != nil {
		return err
	}

	mcpserver.DisplayConnectResult(result)
	return nil
}

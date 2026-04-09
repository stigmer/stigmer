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

// NewDiscoverCommand creates the top-level discover command with resource-type subcommands.
func NewDiscoverCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "discover",
		Short: "Discover capabilities from external services",
		Long: `Connect to external services and discover their capabilities.

Currently supports MCP servers: connect via stdio or HTTP, list available
tools and resource templates, and push the results to stigmer-server.`,
	}

	cmd.AddCommand(newDiscoverMcpServerCommand())

	return cmd
}

func newDiscoverMcpServerCommand() *cobra.Command {
	var (
		timeout  time.Duration
		dryRun   bool
		envFlags []string
	)

	cmd := &cobra.Command{
		Use:   "mcp-server <name-or-id>",
		Short: "Discover tools and resources from an MCP server",
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
  --env is simply more convenient and mirrors stigmer run / stigmer draft.

  During automated flows (bootstrap, apply), well-known variables like
  PLANTON_API_KEY, GITHUB_TOKEN, and STIGMER_API_KEY are auto-resolved
  from local credential stores (Planton CLI, gh CLI, stigmer login).

Examples:
  # Discover by slug (uses default org)
  stigmer discover mcp-server github

  # Discover by org/slug
  stigmer discover mcp-server stigmer/mcp-server-stigmer

  # Pass required credentials via --env
  stigmer discover mcp-server planton-cloud --env PLANTON_API_KEY=pk-xxx

  # Multiple env vars
  stigmer discover mcp-server my-server --env GITHUB_TOKEN=ghp-xxx --env API_URL=https://...

  # Preview without pushing
  stigmer discover mcp-server github --dry-run

  # Custom timeout for slow-starting servers
  stigmer discover mcp-server my-server --timeout 60s`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDiscoverMcpServer(discoverMcpServerOptions{
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

type discoverMcpServerOptions struct {
	Reference    string
	OrgOverride  string
	Timeout      time.Duration
	DryRun       bool
	EnvOverrides []string
}

func executeDiscoverMcpServer(opts discoverMcpServerOptions) error {
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

	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()

	result, err := mcpserver.Discover(context.Background(), &mcpserver.DiscoverOptions{
		Conn:         conn,
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

	mcpserver.DisplayDiscoverResult(result)
	return nil
}

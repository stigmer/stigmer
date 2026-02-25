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
		orgOverride string
		timeout     time.Duration
		dryRun      bool
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

Examples:
  # Discover by slug (uses default org)
  stigmer discover mcp-server github

  # Discover by org/slug
  stigmer discover mcp-server stigmer/stigmer-mcp-server

  # Preview without pushing
  stigmer discover mcp-server github --dry-run

  # Custom timeout for slow-starting servers
  stigmer discover mcp-server my-server --timeout 60s`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDiscoverMcpServer(discoverMcpServerOptions{
				Reference:   args[0],
				OrgOverride: orgOverride,
				Timeout:     timeout,
				DryRun:      dryRun,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")
	cmd.Flags().DurationVar(&timeout, "timeout", 30*time.Second, "timeout for MCP server connection and discovery")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "discover and display results without pushing to backend")

	return cmd
}

type discoverMcpServerOptions struct {
	Reference   string
	OrgOverride string
	Timeout     time.Duration
	DryRun      bool
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
		Conn:    conn,
		OrgID:   orgID,
		Ref:     opts.Reference,
		Timeout: opts.Timeout,
		DryRun:  opts.DryRun,
	})
	if err != nil {
		return err
	}

	mcpserver.DisplayDiscoverResult(result)
	return nil
}

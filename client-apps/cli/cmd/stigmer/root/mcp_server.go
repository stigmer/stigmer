package root

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/mcp-server/pkg/mcpserver"
)

// NewMCPServerCommand creates the top-level command that starts the MCP
// server as a foreground process. MCP clients like Cursor and Claude Desktop
// can spawn the Stigmer CLI with this command instead of requiring a separate
// mcp-server-stigmer binary.
func NewMCPServerCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mcp-server",
		Short: "Start the Stigmer MCP server",
		Long: `Start the MCP server that exposes Stigmer resources to AI coding assistants.

The MCP (Model Context Protocol) server lets tools like Cursor, Claude Desktop,
and Windsurf search, list, and inspect agents, skills, and workflows stored in
stigmer-server.

By default the server runs in STDIO mode — the MCP client spawns this process
and communicates over stdin/stdout. Use --transport http for remote deployments.

Configuration is read from environment variables. CLI flags override the
corresponding env var when set.

Environment variables:
  STIGMER_SERVER_ADDRESS        gRPC address (default "localhost:9090")
  STIGMER_API_KEY               API key (required for stdio/both)
  STIGMER_MCP_TRANSPORT         "stdio" | "http" | "both" (default "stdio")
  STIGMER_MCP_HTTP_PORT         HTTP listen port (default "8080")
  STIGMER_MCP_HTTP_AUTH_ENABLED "true" | "false" (default "true")
  STIGMER_MCP_LOG_FORMAT        "text" | "json" (default "text")
  STIGMER_MCP_LOG_LEVEL         "debug" | "info" | "warn" | "error" (default "info")

Examples:
  # STDIO mode (default — what MCP clients spawn)
  stigmer mcp-server

  # HTTP mode on a custom port
  stigmer mcp-server --transport http --port 9090

  # Cursor mcp.json configuration:
  # { "command": "stigmer", "args": ["mcp-server"] }`,
		SilenceErrors: true,
		SilenceUsage:  true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := mcpserver.DefaultConfig()
			if err != nil {
				return err
			}

			applyFlagOverrides(cmd, cfg)

			ctx, cancel := signal.NotifyContext(
				cmd.Context(), os.Interrupt, syscall.SIGTERM,
			)
			defer cancel()

			return mcpserver.Run(ctx, cfg)
		},
	}

	cmd.Flags().String("transport", "", `transport mode: stdio, http, or both (env: STIGMER_MCP_TRANSPORT)`)
	cmd.Flags().String("port", "", `HTTP listen port (env: STIGMER_MCP_HTTP_PORT)`)
	cmd.Flags().String("server-address", "", `gRPC address of stigmer-server (env: STIGMER_SERVER_ADDRESS)`)
	cmd.Flags().String("api-key", "", `API key for stigmer-server (env: STIGMER_API_KEY)`)
	cmd.Flags().String("log-format", "", `log encoding: text or json (env: STIGMER_MCP_LOG_FORMAT)`)
	cmd.Flags().String("log-level", "", `minimum log level: debug, info, warn, or error (env: STIGMER_MCP_LOG_LEVEL)`)

	return cmd
}

// applyFlagOverrides sets Config fields from CLI flags that were explicitly
// provided. Flags that were not set by the user are left at their env-var
// default values.
func applyFlagOverrides(cmd *cobra.Command, cfg *mcpserver.Config) {
	if v, _ := cmd.Flags().GetString("transport"); v != "" {
		cfg.Transport = v
	}
	if v, _ := cmd.Flags().GetString("port"); v != "" {
		cfg.HTTPPort = v
	}
	if v, _ := cmd.Flags().GetString("server-address"); v != "" {
		cfg.StigmerServerAddress = v
	}
	if v, _ := cmd.Flags().GetString("api-key"); v != "" {
		cfg.APIKey = v
	}
	if v, _ := cmd.Flags().GetString("log-format"); v != "" {
		cfg.LogFormat = v
	}
	if v, _ := cmd.Flags().GetString("log-level"); v != "" {
		cfg.LogLevel = v
	}
}

package root

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// NewMCPServerCommand creates the top-level command that starts the MCP
// server as a foreground process. MCP clients like Cursor and Claude Desktop
// can spawn the Stigmer CLI with this command instead of requiring a separate
// mcp-server-stigmer binary.
//
// The MCP server is the TypeScript @stigmer/mcp-server npm package. This
// command bridges CLI config and flags into the environment variables the
// server expects, then launches it via Node (workspace tsx in development, or
// npx in production) — see resolveMCPServerCommand.
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

Configuration precedence: CLI flags > env vars > ~/.stigmer/config.yaml > defaults.

When running via the CLI, the server address and API key are automatically
resolved from ~/.stigmer/config.yaml if the corresponding environment
variables are not set. Local backends connect without authentication;
cloud backends use the stored token.

ENVIRONMENT VARIABLES:

  STIGMER_SERVER_ADDRESS        gRPC address (default from CLI config or "localhost:9090")
  STIGMER_API_KEY               API key (optional; auto-resolved from CLI config for cloud)
  STIGMER_MCP_TRANSPORT         "stdio" | "http" | "both" (default "stdio")
  STIGMER_MCP_HTTP_PORT         HTTP listen port (default "8080")
  STIGMER_MCP_HTTP_AUTH_ENABLED "true" | "false" (default "true")
  STIGMER_MCP_LOG_FORMAT        "text" | "json" (default "text")
  STIGMER_MCP_LOG_LEVEL         "debug" | "info" | "warn" | "error" (default "info")`,
		Example: `  # STDIO mode (default — what MCP clients spawn)
  stigmer mcp-server

  # HTTP mode on a custom port
  stigmer mcp-server --transport http --port 9090

  # Cursor mcp.json configuration:
  # { "command": "stigmer", "args": ["mcp-server"] }`,
		SilenceErrors: true,
		SilenceUsage:  true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			bridgeCLIConfigToEnv()
			bridgeFlagsToEnv(cmd)

			mcpCmd, err := resolveMCPServerCommand(buildMCPServerArgs(cmd))
			if err != nil {
				return err
			}

			mcpCmd.Stdin = os.Stdin
			mcpCmd.Stdout = os.Stdout
			mcpCmd.Stderr = os.Stderr
			return mcpCmd.Run()
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

// bridgeCLIConfigToEnv reads ~/.stigmer/config.yaml and sets environment
// variables so the standalone MCP server binary picks them up. Only sets a
// variable when the corresponding env var is not already set, preserving the
// precedence: env vars > CLI config > MCP defaults.
func bridgeCLIConfigToEnv() {
	cliCfg, err := config.Load()
	if err != nil {
		return
	}
	applyCLIConfigEnv(cliCfg)
}

// applyCLIConfigEnv applies settings from a CLI config to environment
// variables. Extracted for testability.
func applyCLIConfigEnv(cliCfg *config.Config) {
	switch cliCfg.Backend.Type {
	case config.BackendTypeLocal:
		setEnvIfEmpty("STIGMER_SERVER_ADDRESS", "localhost:7234")

	case config.BackendTypeCloud:
		if cliCfg.Backend.Cloud == nil {
			return
		}
		setEnvIfEmpty("STIGMER_SERVER_ADDRESS", cliCfg.Backend.Cloud.Endpoint)
		setEnvIfEmpty("STIGMER_API_KEY", cliCfg.Backend.Cloud.Token)
	}
}

// bridgeFlagsToEnv maps explicitly-set CLI flags to the MCP server's
// environment variables. Flags that were not set by the user are skipped.
func bridgeFlagsToEnv(cmd *cobra.Command) {
	flagEnvMap := []struct {
		flag string
		env  string
	}{
		{"transport", "STIGMER_MCP_TRANSPORT"},
		{"port", "STIGMER_MCP_HTTP_PORT"},
		{"server-address", "STIGMER_SERVER_ADDRESS"},
		{"api-key", "STIGMER_API_KEY"},
		{"log-format", "STIGMER_MCP_LOG_FORMAT"},
		{"log-level", "STIGMER_MCP_LOG_LEVEL"},
	}

	for _, m := range flagEnvMap {
		if v, _ := cmd.Flags().GetString(m.flag); v != "" {
			os.Setenv(m.env, v)
		}
	}
}

// setEnvIfEmpty sets key=value only when key is currently unset or empty.
func setEnvIfEmpty(key, value string) {
	if value != "" && os.Getenv(key) == "" {
		os.Setenv(key, value)
	}
}

// resolveMCPServerCommand builds an exec.Cmd that launches the TypeScript
// @stigmer/mcp-server, using the same three-tier resolution strategy as the
// Ink renderer (see resolveInkCommand). The Go CLI no longer ships or downloads
// a native MCP server binary — the server is the npm package, run via Node.
//
//  1. STIGMER_MCP_SERVER_CMD env var — escape hatch for custom setups.
//  2. Workspace detection — first from the binary location (bin/stigmer),
//     then by walking up from CWD — runs the source via the workspace tsx.
//  3. npx with pinned version — production path, downloads on first run.
func resolveMCPServerCommand(args []string) (*exec.Cmd, error) {
	// 1. Escape hatch: explicit override.
	if override := os.Getenv("STIGMER_MCP_SERVER_CMD"); override != "" {
		parts := strings.Fields(override)
		return exec.Command(parts[0], append(parts[1:], args...)...), nil
	}

	// 2a. Workspace detection from binary location (development).
	// When the CLI is built with `make build` the binary lands at
	// <workspace>/bin/stigmer; tsx and the source entry are resolved
	// relative to it.
	if exePath, err := os.Executable(); err == nil {
		workspaceRoot := filepath.Join(filepath.Dir(exePath), "..")
		if cmd, ok := tryWorkspaceMCPServer(workspaceRoot, args); ok {
			return cmd, nil
		}
	}

	// 2b. Workspace detection from CWD — handles binaries installed outside
	// the repo (~/bin, $GOPATH/bin, bazel output, etc.).
	if cwd, err := os.Getwd(); err == nil {
		if root := findWorkspaceRoot(cwd); root != "" {
			if cmd, ok := tryWorkspaceMCPServer(root, args); ok {
				return cmd, nil
			}
		}
	}

	// 3. Production: npx with pinned version.
	npxPath, err := exec.LookPath("npx")
	if err != nil {
		return nil, fmt.Errorf(
			"the Stigmer MCP server runs on Node.js >= 20\n" +
				"Install Node.js from https://nodejs.org and try again")
	}

	npxArgs := append([]string{"--yes", mcpServerPackageSpec()}, args...)
	return exec.Command(npxPath, npxArgs...), nil
}

// tryWorkspaceMCPServer checks whether root looks like the stigmer monorepo
// workspace and returns a tsx command for the MCP server source entry if so.
func tryWorkspaceMCPServer(root string, args []string) (*exec.Cmd, bool) {
	tsxBin := filepath.Join(root, "node_modules", ".bin", "tsx")
	entry := filepath.Join(root, "mcp-server", "src", "cli", "mcp-server-stigmer.ts")

	if fileExists(tsxBin) && fileExists(entry) {
		return exec.Command(tsxBin, append([]string{entry}, args...)...), true
	}
	return nil, false
}

// mcpServerPackageSpec resolves the npm spec for @stigmer/mcp-server. It pins to
// the CLI's build version (set via ldflags, derived from the same git tag as the
// CLI release), falling back to the @dev dist-tag for unversioned dev builds —
// where tier 2 (workspace tsx) wins inside the monorepo anyway.
func mcpServerPackageSpec() string {
	version := strings.TrimPrefix(embedded.GetBuildVersion(), "v")
	if version == "" || version == "dev" {
		return "@stigmer/mcp-server@dev"
	}
	return "@stigmer/mcp-server@" + version
}

// buildMCPServerArgs constructs the trailing argv for the MCP server command.
// The server accepts an optional positional transport subcommand.
func buildMCPServerArgs(cmd *cobra.Command) []string {
	var args []string
	if v, _ := cmd.Flags().GetString("transport"); v != "" {
		args = append(args, v)
	}
	return args
}

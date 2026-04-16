package root

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const mcpServerBinaryName = "mcp-server-stigmer"

// NewMCPServerCommand creates the top-level command that starts the MCP
// server as a foreground process. MCP clients like Cursor and Claude Desktop
// can spawn the Stigmer CLI with this command instead of requiring a separate
// mcp-server-stigmer binary.
//
// Rather than importing the mcp-server Go module (which would pull in a
// second copy of the protobuf stubs and cause registration panics), this
// command resolves the standalone mcp-server-stigmer binary, bridges CLI
// config and flags into the environment variables the binary expects, and
// exec's it.
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

			binPath, err := resolveMCPServerBinary()
			if err != nil {
				return err
			}

			args := buildMCPServerArgs(cmd)
			return execMCPServer(binPath, args)
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

// resolveMCPServerBinary finds the mcp-server-stigmer binary.
//
// Resolution order:
//  1. ~/.stigmer/bin/mcp-server-stigmer (managed install location)
//  2. mcp-server-stigmer on PATH
//  3. Auto-download from GitHub releases to ~/.stigmer/bin/
func resolveMCPServerBinary() (string, error) {
	home, _ := os.UserHomeDir()
	if home != "" {
		managed := filepath.Join(home, ".stigmer", "bin", mcpServerBinaryName)
		if isExecutable(managed) {
			return managed, nil
		}
	}

	if path, err := exec.LookPath(mcpServerBinaryName); err == nil {
		return path, nil
	}

	climsg.Info("mcp-server-stigmer not found, downloading from GitHub releases...")
	path, err := daemon.DownloadMCPServerBinary()
	if err != nil {
		return "", fmt.Errorf(
			"%s not found and auto-download failed: %w\n\n"+
				"Install manually with:\n"+
				"  go install github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest\n\n"+
				"Or download from: https://github.com/stigmer/stigmer/releases",
			mcpServerBinaryName, err,
		)
	}

	return path, nil
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Mode()&0111 != 0
}

// buildMCPServerArgs constructs the argv for the MCP server binary.
// The binary accepts an optional positional transport subcommand.
func buildMCPServerArgs(cmd *cobra.Command) []string {
	args := []string{mcpServerBinaryName}
	if v, _ := cmd.Flags().GetString("transport"); v != "" {
		args = append(args, v)
	}
	return args
}

// execMCPServer replaces the current process with the MCP server binary.
// On Unix this uses syscall.Exec for seamless STDIO passthrough; on Windows
// it falls back to exec.Command with inherited file descriptors.
func execMCPServer(binPath string, args []string) error {
	if runtime.GOOS == "windows" {
		cmd := exec.Command(binPath, args[1:]...)
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	return syscall.Exec(binPath, args, os.Environ())
}

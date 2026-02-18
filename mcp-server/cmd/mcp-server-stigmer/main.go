// Command mcp-server-stigmer is the Model Context Protocol server for the
// Stigmer platform.
//
// It exposes a small set of tools that let MCP-capable AI clients (Cursor,
// Claude Desktop, Windsurf, etc.) search, list, and inspect agents, skills,
// and workflows stored in stigmer-server.
//
// # Transports
//
// The server supports two communication modes selected via the
// STIGMER_MCP_TRANSPORT environment variable:
//
//   - "stdio" (default): The MCP client spawns this binary as a child process
//     and communicates over stdin/stdout. Ideal for local development.
//   - "http": The server listens on a TCP port and serves Streamable HTTP.
//     Ideal for shared or remote deployments.
//   - "both": Runs STDIO and HTTP simultaneously in separate goroutines.
//
// # Configuration
//
// All settings are read from environment variables — see the config package
// for the full list.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/stigmer/stigmer/mcp-server/pkg/mcpserver"
)

func main() {
	cfg, err := mcpserver.DefaultConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := mcpserver.Run(ctx, cfg); err != nil {
		os.Exit(1)
	}
}

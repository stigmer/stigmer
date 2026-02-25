// Command mcp-server-stigmer is the Model Context Protocol server for the
// Stigmer platform.
//
// It exposes a small set of tools that let MCP-capable AI clients (Cursor,
// Claude Desktop, Windsurf, etc.) search, list, and inspect agents, skills,
// and workflows stored in stigmer-server.
//
// # Usage
//
//	mcp-server-stigmer stdio       Start in stdio mode (stdin/stdout JSON-RPC)
//	mcp-server-stigmer http        Start in HTTP mode (Streamable HTTP)
//	mcp-server-stigmer both        Start both transports simultaneously
//
// When no subcommand is given, the transport is read from the
// STIGMER_MCP_TRANSPORT environment variable (default: "stdio").
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

var validTransports = map[string]bool{
	"stdio": true,
	"http":  true,
	"both":  true,
}

func main() {
	cfg, err := mcpserver.DefaultConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
		os.Exit(1)
	}

	// Positional subcommand overrides the env-var-based transport.
	if len(os.Args) > 1 {
		sub := os.Args[1]
		if !validTransports[sub] {
			fmt.Fprintf(os.Stderr, "unknown subcommand %q (expected stdio, http, or both)\n", sub)
			os.Exit(1)
		}
		cfg.Transport = sub
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := mcpserver.Run(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

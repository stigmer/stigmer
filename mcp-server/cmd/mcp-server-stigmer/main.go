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
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/stigmer/stigmer/mcp-server/internal/config"
	"github.com/stigmer/stigmer/mcp-server/internal/server"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		// slog is not yet configured; write to stderr directly.
		fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
		os.Exit(1)
	}

	initLogger(cfg)

	srv := server.New(cfg)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	switch cfg.Transport {
	case config.TransportStdio:
		slog.Info("starting MCP server", "transport", "stdio")
		if err := srv.ServeStdio(ctx); err != nil {
			slog.Error("stdio server failed", "err", err)
			os.Exit(1)
		}

	case config.TransportHTTP:
		slog.Info("starting MCP server", "transport", "http")
		if err := srv.ServeHTTP(ctx); err != nil {
			slog.Error("http server failed", "err", err)
			os.Exit(1)
		}

	case config.TransportBoth:
		slog.Info("starting MCP server", "transport", "both")
		var wg sync.WaitGroup
		errs := make(chan error, 2)

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := srv.ServeHTTP(ctx); err != nil {
				errs <- err
			}
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := srv.ServeStdio(ctx); err != nil {
				errs <- err
			}
		}()

		select {
		case <-ctx.Done():
			slog.Info("shutdown signal received")
		case err := <-errs:
			slog.Error("server error", "err", err)
			cancel()
		}
		wg.Wait()

	default:
		slog.Error("unknown transport", "transport", cfg.Transport)
		os.Exit(1)
	}

	slog.Info("mcp-server-stigmer stopped")
}

// initLogger configures the process-wide default slog logger.
// All output goes to stderr so that stdout remains available for
// the STDIO MCP transport (which uses stdout for protocol messages).
func initLogger(cfg *config.Config) {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}

	var handler slog.Handler
	switch cfg.LogFormat {
	case config.LogFormatJSON:
		handler = slog.NewJSONHandler(os.Stderr, opts)
	default:
		handler = slog.NewTextHandler(os.Stderr, opts)
	}

	slog.SetDefault(slog.New(handler))
}

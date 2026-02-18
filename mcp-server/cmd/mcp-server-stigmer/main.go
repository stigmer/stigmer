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
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/stigmer/stigmer/mcp-server/internal/config"
	"github.com/stigmer/stigmer/mcp-server/internal/server"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	srv := server.New(cfg)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	switch cfg.Transport {
	case config.TransportStdio:
		log.Println("transport: stdio")
		if err := srv.ServeStdio(ctx); err != nil {
			log.Fatalf("stdio server: %v", err)
		}

	case config.TransportHTTP:
		log.Println("transport: http")
		if err := srv.ServeHTTP(); err != nil {
			log.Fatalf("http server: %v", err)
		}

	case config.TransportBoth:
		log.Println("transport: both (stdio + http)")
		var wg sync.WaitGroup
		errs := make(chan error, 2)

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := srv.ServeHTTP(); err != nil {
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
			log.Println("shutdown signal received")
		case err := <-errs:
			log.Printf("server error: %v", err)
			cancel()
		}
		wg.Wait()

	default:
		log.Fatalf("unknown transport: %q", cfg.Transport)
	}

	log.Println("mcp-server-stigmer stopped")
}

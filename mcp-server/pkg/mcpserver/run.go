package mcpserver

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"github.com/stigmer/stigmer/mcp-server/internal/config"
	"github.com/stigmer/stigmer/mcp-server/internal/server"
)

// Run starts the MCP server with the given configuration and blocks until
// ctx is cancelled or a fatal error occurs.
//
// The caller is responsible for setting up signal handling on the context.
// For example:
//
//	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
//	defer cancel()
//	if err := mcpserver.Run(ctx, cfg); err != nil { log.Fatal(err) }
func Run(ctx context.Context, cfg *Config) error {
	ic, err := cfg.toInternal()
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	initLogger(ic)

	slog.Info("mcp-server-stigmer starting", "transport", ic.Transport)

	srv := server.New(ic)

	var serveErr error
	switch ic.Transport {
	case config.TransportStdio:
		serveErr = srv.ServeStdio(ctx)
	case config.TransportHTTP:
		serveErr = srv.ServeHTTP(ctx)
	case config.TransportBoth:
		serveErr = serveBoth(ctx, srv)
	default:
		return fmt.Errorf("unknown transport %q", ic.Transport)
	}

	slog.Info("mcp-server-stigmer stopped")
	return serveErr
}

// serveBoth runs STDIO and HTTP concurrently. The first transport error
// triggers cancellation of the other via a derived context.
func serveBoth(ctx context.Context, srv *server.Server) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	errs := make(chan error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := srv.ServeHTTP(ctx); err != nil {
			errs <- err
		}
	}()
	go func() {
		defer wg.Done()
		if err := srv.ServeStdio(ctx); err != nil {
			errs <- err
		}
	}()

	var firstErr error
	select {
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	case firstErr = <-errs:
		slog.Error("transport error, shutting down", "err", firstErr)
		cancel()
	}

	wg.Wait()
	return firstErr
}

// initLogger configures the process-wide default slog logger.
// All output goes to stderr so that stdout remains available for the STDIO
// MCP transport (which uses stdout for JSON-RPC messages).
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

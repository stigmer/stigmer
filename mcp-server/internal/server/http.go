package server

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
)

const shutdownGracePeriod = 5 * time.Second

// ServeHTTP starts the Streamable HTTP transport on the configured port and
// blocks until ctx is cancelled or a fatal listen error occurs.
//
// In HTTP mode, each request carries its own API key via the Authorization
// header. The auth middleware extracts the Bearer token and injects it into
// the request context before the MCP handler sees it. This means tool handlers
// always get their API key from auth.GetAPIKey(ctx) regardless of transport.
//
// When HTTPAuthEnabled is false (e.g. behind a trusted reverse proxy that
// already verified the token), the auth middleware is bypassed.
//
// On context cancellation the server drains in-flight requests for up to 5
// seconds before forcing a shutdown.
func (s *Server) ServeHTTP(ctx context.Context) error {
	mcpHandler := mcp.NewStreamableHTTPHandler(
		func(_ *http.Request) *mcp.Server {
			return s.mcp
		},
		nil,
	)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)

	var handler http.Handler = mcpHandler
	if s.config.HTTPAuthEnabled {
		handler = authMiddleware(handler)
	}
	mux.Handle("/", handler)

	addr := ":" + s.config.HTTPPort
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           requestLogger(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	slog.Info("HTTP transport listening", "addr", addr, "auth_enabled", s.config.HTTPAuthEnabled)

	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		slog.Info("HTTP server shutting down", "grace_period", shutdownGracePeriod)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGracePeriod)
		defer cancel()
		return httpSrv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

// authMiddleware extracts an Authorization: Bearer token from the HTTP request
// and injects it into the context via auth.WithAPIKey. Requests without a
// valid token are rejected with 401 Unauthorized.
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			http.Error(w, "missing or malformed Authorization: Bearer header", http.StatusUnauthorized)
			return
		}
		ctx := auth.WithAPIKey(r.Context(), token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractBearerToken parses the "Authorization: Bearer <token>" header.
func extractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// healthHandler returns a simple 200 OK for liveness probes.
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintln(w, `{"status":"ok"}`)
}

// requestLogger is an HTTP middleware that assigns a short request ID to each
// inbound request and logs the method, path, status, and duration.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := shortID()

		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		slog.Info("http request",
			"request_id", reqID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// shortID returns a 16-character hex string suitable for request correlation.
// It uses crypto/rand for uniqueness without pulling in a UUID dependency.
func shortID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x", b)
}

// statusWriter wraps http.ResponseWriter to capture the status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

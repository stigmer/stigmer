package server

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
)

// ServeHTTP starts the Streamable HTTP transport on the configured port.
//
// In HTTP mode, each request carries its own API key via the Authorization
// header. The auth middleware extracts the Bearer token and injects it into
// the request context before the MCP handler sees it. This means tool handlers
// always get their API key from auth.GetAPIKey(ctx) regardless of transport.
//
// When HTTPAuthEnabled is false (e.g. behind a trusted reverse proxy that
// already verified the token), the auth middleware is bypassed.
func (s *Server) ServeHTTP() error {
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
	log.Printf("HTTP transport listening on %s (auth_enabled=%v)", addr, s.config.HTTPAuthEnabled)
	return http.ListenAndServe(addr, requestLogger(mux))
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

// requestLogger is a lightweight HTTP middleware that logs method, path, and
// response status for every request.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("HTTP %s %s → %d", r.Method, r.URL.Path, sw.status)
	})
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

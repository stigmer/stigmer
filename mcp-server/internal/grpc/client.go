// Package grpc provides a factory for creating authenticated client
// connections to stigmer-server.
//
// Each tool invocation creates a short-lived connection via [NewConnection],
// performs the gRPC call, and closes the connection.  This is intentionally
// simple: the MCP server processes a low volume of tool calls and connection
// setup is fast on localhost.  If profiling reveals that connection setup is a
// bottleneck we can introduce pooling later without changing the call sites.
package grpc

import (
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// DefaultRPCTimeout is applied to each outbound gRPC call so that a
// misconfigured or unreachable server address fails fast rather than hanging
// until the system-level TCP timeout. 30 seconds is generous for both
// localhost (milliseconds) and remote endpoints (low seconds).
const DefaultRPCTimeout = 30 * time.Second

// NewConnection dials a gRPC endpoint and returns an authenticated connection.
//
// The raw endpoint string is normalized via [NormalizeEndpoint] before dialing.
// Transport security is derived from the resolved port:
//   - port 443 → TLS with the system root CA pool
//   - anything else → plaintext (suitable for localhost and internal networks)
//
// The supplied apiKey is attached to every RPC via [auth.TokenAuth] which
// implements grpc.PerRPCCredentials.
//
// The caller is responsible for calling Close on the returned connection.
func NewConnection(endpoint, apiKey string) (*grpc.ClientConn, error) {
	target, useTLS := NormalizeEndpoint(endpoint)
	if target != endpoint {
		slog.Info("normalized gRPC endpoint",
			"original", endpoint,
			"resolved", target,
			"tls", useTLS,
		)
	}

	var tc credentials.TransportCredentials
	if useTLS {
		tc = credentials.NewTLS(nil) // system root CAs
	} else {
		tc = insecure.NewCredentials()
	}

	opts := []grpc.DialOption{grpc.WithTransportCredentials(tc)}
	if apiKey != "" {
		opts = append(opts, grpc.WithPerRPCCredentials(auth.NewTokenAuth(apiKey)))
	}

	conn, err := grpc.NewClient(target, opts...)
	if err != nil {
		return nil, fmt.Errorf("grpc dial %s: %w", target, err)
	}
	return conn, nil
}

// NormalizeEndpoint transforms a user-provided address into the host:port
// format that grpc.NewClient expects, and reports whether TLS should be used.
//
// Transformations applied in order:
//  1. Leading/trailing whitespace is trimmed.
//  2. URL schemes (https://, http://) are stripped — gRPC targets are host:port.
//  3. Trailing slashes are removed.
//  4. If no port is present and the host is not a loopback address,
//     :443 is appended and TLS is enabled.
//
// Examples:
//
//	"api.example.com:443"         → ("api.example.com:443", true)
//	"https://api.example.com"     → ("api.example.com:443", true)
//	"api.example.com"             → ("api.example.com:443", true)
//	"http://internal:8080"        → ("internal:8080",       false)
//	"localhost:7234"              → ("localhost:7234",       false)
//	"localhost"                   → ("localhost",            false)
func NormalizeEndpoint(raw string) (endpoint string, useTLS bool) {
	endpoint = strings.TrimSpace(raw)
	if endpoint == "" {
		return "", false
	}

	lower := strings.ToLower(endpoint)
	if strings.HasPrefix(lower, "https://") {
		endpoint = endpoint[len("https://"):]
	} else if strings.HasPrefix(lower, "http://") {
		endpoint = endpoint[len("http://"):]
	}

	endpoint = strings.TrimRight(endpoint, "/")

	_, port, err := net.SplitHostPort(endpoint)
	if err == nil {
		return endpoint, port == "443"
	}

	// No port present.
	if isLoopback(endpoint) {
		return endpoint, false
	}

	return net.JoinHostPort(endpoint, "443"), true
}

func isLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

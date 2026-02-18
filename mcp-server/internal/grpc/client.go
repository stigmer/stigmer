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
	"strings"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// NewConnection dials a gRPC endpoint and returns an authenticated connection.
//
// Transport security is determined by convention:
//   - port 443 → TLS with the system root CA pool
//   - anything else → plaintext (suitable for localhost and internal networks)
//
// The supplied apiKey is attached to every RPC via [auth.TokenAuth] which
// implements grpc.PerRPCCredentials.
//
// The caller is responsible for calling Close on the returned connection.
func NewConnection(endpoint, apiKey string) (*grpc.ClientConn, error) {
	var tc credentials.TransportCredentials
	if strings.HasSuffix(endpoint, ":443") {
		tc = credentials.NewTLS(nil) // system root CAs
	} else {
		tc = insecure.NewCredentials()
	}

	conn, err := grpc.NewClient(
		endpoint,
		grpc.WithTransportCredentials(tc),
		grpc.WithPerRPCCredentials(auth.NewTokenAuth(apiKey)),
	)
	if err != nil {
		return nil, fmt.Errorf("grpc dial %s: %w", endpoint, err)
	}
	return conn, nil
}

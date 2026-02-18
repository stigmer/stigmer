// Package auth bridges the MCP transport layer and the gRPC client layer.
//
// # Context-based API key propagation
//
// The MCP server receives an API key from one of two sources depending on the
// active transport:
//
//   - STDIO mode: the key is read once at startup from the STIGMER_API_KEY
//     environment variable and injected into the base context that is passed
//     to mcp.Server.Run.
//   - HTTP mode: every inbound HTTP request carries its own key in the
//     Authorization: Bearer header. The HTTP middleware extracts it and
//     stores it in the request context before the MCP SDK sees it.
//
// Either way, by the time a typed tool handler runs, the API key is available
// via [APIKey] (or the stricter [GetAPIKey]). The gRPC client layer reads it
// and turns it into a [grpc.PerRPCCredentials] value that is attached to every
// outbound gRPC call.
//
// When the MCP server targets an unauthenticated backend (e.g. the local
// daemon on localhost:7234), no API key is injected and [APIKey] returns an
// empty string. The gRPC client layer skips PerRPCCredentials in that case.
//
// This design avoids the global-mutex workaround that Planton's MCP server
// (built on the older community mcp-go SDK) is forced to use, because the
// official Go SDK passes context.Context all the way through to tool handlers.
package auth

import (
	"context"
	"fmt"
)

// contextKey is an unexported type to prevent collisions with keys defined in
// other packages.
type contextKey struct{}

// WithAPIKey returns a child context that carries the given API key.
func WithAPIKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, contextKey{}, key)
}

// APIKey returns the API key from the context, or an empty string if none was
// set. Use this in code paths that work with or without authentication (e.g.
// domain Fetch functions that may target an unauthenticated local backend).
func APIKey(ctx context.Context) string {
	v, _ := ctx.Value(contextKey{}).(string)
	return v
}

// GetAPIKey extracts the API key previously stored by [WithAPIKey].
// It returns an error when the key is absent or empty. Use this in code paths
// that strictly require authentication (e.g. HTTP auth middleware validation).
func GetAPIKey(ctx context.Context) (string, error) {
	v, ok := ctx.Value(contextKey{}).(string)
	if !ok || v == "" {
		return "", fmt.Errorf("no API key in context — ensure the transport layer injects one")
	}
	return v, nil
}

// TokenAuth implements [google.golang.org/grpc/credentials.PerRPCCredentials].
// It attaches an "Authorization: Bearer <token>" header to every outbound
// gRPC call so that stigmer-server can identify the caller.
type TokenAuth struct {
	token string
}

// NewTokenAuth returns a TokenAuth that will send the given token.
func NewTokenAuth(token string) TokenAuth {
	return TokenAuth{token: token}
}

// GetRequestMetadata satisfies the PerRPCCredentials interface.
func (t TokenAuth) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	return map[string]string{
		"Authorization": "Bearer " + t.token,
	}, nil
}

// RequireTransportSecurity returns false so that the credentials can be used
// over both TLS and plaintext connections. TLS enforcement is handled at the
// transport-credential level when dialling the gRPC endpoint.
func (TokenAuth) RequireTransportSecurity() bool {
	return false
}

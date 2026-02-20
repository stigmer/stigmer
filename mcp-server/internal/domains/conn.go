package domains

import (
	"context"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
	"google.golang.org/grpc"
)

// WithConnection creates an authenticated gRPC connection with timeout,
// passes it to fn, and ensures cleanup. This eliminates the 7-line
// connect/auth/timeout/defer pattern repeated in every domain function.
//
// The API key is read from ctx via [auth.APIKey]. The connection targets
// serverAddress using the transport rules in [stigmergrpc.NewConnection].
// The context passed to fn has a deadline of [stigmergrpc.DefaultRPCTimeout].
func WithConnection(ctx context.Context, serverAddress string,
	fn func(ctx context.Context, conn *grpc.ClientConn) (string, error),
) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", err
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	return fn(rpcCtx, conn)
}

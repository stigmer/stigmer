package transport

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const authHeader = "authorization"

// tokenSource answers the bearer token for one call: a fixed key's, or the
// caller's own func (WithTokenFunc), asked on every call so a token that
// expires is fetched again.
type tokenSource func(ctx context.Context) (string, error)

func fixedToken(token string) tokenSource {
	return func(context.Context) (string, error) { return token, nil }
}

var errEmptyToken = errors.New("stigmer: the token func returned an empty token")

// withAuth adds the Authorization header, or answers the token func's error
// before anything is sent.
func withAuth(ctx context.Context, token tokenSource) (context.Context, error) {
	value, err := token(ctx)
	if err != nil {
		return ctx, fmt.Errorf("stigmer: the token func failed: %w", err)
	}
	if value == "" {
		return ctx, errEmptyToken
	}
	return metadata.AppendToOutgoingContext(ctx, authHeader, "Bearer "+value), nil
}

func unaryAuthInterceptor(token tokenSource) grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply any,
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		ctx, err := withAuth(ctx, token)
		if err != nil {
			return err
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

func streamAuthInterceptor(token tokenSource) grpc.StreamClientInterceptor {
	return func(
		ctx context.Context,
		desc *grpc.StreamDesc,
		cc *grpc.ClientConn,
		method string,
		streamer grpc.Streamer,
		opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		ctx, err := withAuth(ctx, token)
		if err != nil {
			return nil, err
		}
		return streamer(ctx, desc, cc, method, opts...)
	}
}

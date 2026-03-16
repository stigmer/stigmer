package transport

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const authHeader = "authorization"

func unaryAuthInterceptor(apiKey string) grpc.UnaryClientInterceptor {
	bearerToken := "Bearer " + apiKey
	return func(
		ctx context.Context,
		method string,
		req, reply any,
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		ctx = metadata.AppendToOutgoingContext(ctx, authHeader, bearerToken)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

func streamAuthInterceptor(apiKey string) grpc.StreamClientInterceptor {
	bearerToken := "Bearer " + apiKey
	return func(
		ctx context.Context,
		desc *grpc.StreamDesc,
		cc *grpc.ClientConn,
		method string,
		streamer grpc.Streamer,
		opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		ctx = metadata.AppendToOutgoingContext(ctx, authHeader, bearerToken)
		return streamer(ctx, desc, cc, method, opts...)
	}
}

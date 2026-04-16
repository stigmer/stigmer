package transport

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const authHeader = "authorization"

func unaryAuthInterceptor(token string) grpc.UnaryClientInterceptor {
	headerValue := "Bearer " + token
	return func(
		ctx context.Context,
		method string,
		req, reply any,
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		ctx = metadata.AppendToOutgoingContext(ctx, authHeader, headerValue)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

func streamAuthInterceptor(token string) grpc.StreamClientInterceptor {
	headerValue := "Bearer " + token
	return func(
		ctx context.Context,
		desc *grpc.StreamDesc,
		cc *grpc.ClientConn,
		method string,
		streamer grpc.Streamer,
		opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		ctx = metadata.AppendToOutgoingContext(ctx, authHeader, headerValue)
		return streamer(ctx, desc, cc, method, opts...)
	}
}

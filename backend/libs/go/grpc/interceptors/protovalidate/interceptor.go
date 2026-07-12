// Package protovalidate provides gRPC server interceptors that enforce
// protobuf field constraints (buf.validate) at the transport boundary.
//
// This is the platform-wide guarantee that every RPC's request is validated
// against the constraints declared in its proto before any handler runs —
// regardless of whether the handler uses the request pipeline or is written as
// a direct method. Field-constraint violations surface as InvalidArgument with
// a clean gRPC status. Handlers therefore must not re-implement proto field
// validation; business-rule validation still belongs in the domain layer.
package protovalidate

import (
	"context"

	pv "buf.build/go/protovalidate"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// UnaryServerInterceptor validates every unary request message against its
// proto field constraints before invoking the handler.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	validator := grpclib.SharedValidator()
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		if msg, ok := req.(proto.Message); ok {
			if err := validator.Validate(msg); err != nil {
				return nil, grpclib.InvalidArgumentError("%v", err)
			}
		}
		return handler(ctx, req)
	}
}

// StreamServerInterceptor validates each request message a streaming RPC
// receives. For server-streaming RPCs (the only streaming shape in this
// service today), gRPC delivers the single client request via ServerStream's
// RecvMsg, so wrapping RecvMsg is what enforces constraints on those requests.
func StreamServerInterceptor() grpc.StreamServerInterceptor {
	validator := grpclib.SharedValidator()
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		return handler(srv, &validatingServerStream{ServerStream: ss, validator: validator})
	}
}

type validatingServerStream struct {
	grpc.ServerStream
	validator pv.Validator
}

func (s *validatingServerStream) RecvMsg(m interface{}) error {
	if err := s.ServerStream.RecvMsg(m); err != nil {
		return err
	}
	if msg, ok := m.(proto.Message); ok {
		if err := s.validator.Validate(msg); err != nil {
			return grpclib.InvalidArgumentError("%v", err)
		}
	}
	return nil
}

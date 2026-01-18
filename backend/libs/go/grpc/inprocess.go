// Package grpc provides gRPC server utilities for Stigmer services
package grpc

import (
	"context"
	"net"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

const bufSize = 1024 * 1024 // 1MB buffer for in-process communication

// InProcessServer wraps a gRPC server with an in-process listener using bufconn.
// This enables in-process gRPC calls that go through the full gRPC stack
// (interceptors, marshalling, etc.) without network overhead.
type InProcessServer struct {
	grpcServer *grpc.Server
	listener   *bufconn.Listener
}

// NewInProcessServer creates a new in-process gRPC server with the same
// interceptors and configuration as a network server.
//
// This server uses bufconn for in-process communication, ensuring:
//   - All interceptors execute (validation, logging, etc.)
//   - Full gRPC request/response lifecycle
//   - Zero network overhead
//   - Migration-ready for microservices
func NewInProcessServer(opts ...ServerOption) *InProcessServer {
	options := &serverOptions{}
	for _, opt := range opts {
		opt(options)
	}

	// Add logging interceptor first
	unaryInterceptors := append(
		[]grpc.UnaryServerInterceptor{loggingUnaryInterceptor},
		options.unaryInterceptors...,
	)

	streamInterceptors := append(
		[]grpc.StreamServerInterceptor{loggingStreamInterceptor},
		options.streamInterceptors...,
	)

	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(unaryInterceptors...),
		grpc.ChainStreamInterceptor(streamInterceptors...),
		grpc.MaxRecvMsgSize(10*1024*1024), // 10MB
		grpc.MaxSendMsgSize(10*1024*1024), // 10MB
	)

	return &InProcessServer{
		grpcServer: grpcServer,
		listener:   bufconn.Listen(bufSize),
	}
}

// GRPCServer returns the underlying gRPC server for service registration
func (s *InProcessServer) GRPCServer() *grpc.Server {
	return s.grpcServer
}

// Start starts serving the in-process gRPC server in a goroutine.
// This should be called after all services are registered.
func (s *InProcessServer) Start() {
	go func() {
		log.Debug().Msg("Starting in-process gRPC server")
		if err := s.grpcServer.Serve(s.listener); err != nil {
			log.Error().Err(err).Msg("In-process gRPC server error")
		}
	}()
}

// Stop gracefully stops the in-process gRPC server
func (s *InProcessServer) Stop() {
	log.Debug().Msg("Stopping in-process gRPC server")
	s.grpcServer.GracefulStop()
}

// NewConnection creates a new gRPC client connection to the in-process server.
// This connection goes through the full gRPC stack with all interceptors.
//
// The caller is responsible for closing the connection when done.
func (s *InProcessServer) NewConnection(ctx context.Context) (*grpc.ClientConn, error) {
	// Create dialer that connects to the bufconn listener
	bufDialer := func(context.Context, string) (net.Conn, error) {
		return s.listener.Dial()
	}

	conn, err := grpc.DialContext(
		ctx,
		"bufnet",
		grpc.WithContextDialer(bufDialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		// Add any client interceptors here if needed in the future
	)
	if err != nil {
		return nil, err
	}

	log.Debug().Msg("Created in-process gRPC client connection")
	return conn, nil
}

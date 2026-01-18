// Package grpc provides gRPC server utilities for Stigmer services
package grpc

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

// Server wraps a gRPC server with lifecycle management and in-process support
type Server struct {
	grpcServer       *grpc.Server
	listener         net.Listener
	port             int
	inProcessEnabled bool
	bufListener      *bufconn.Listener
}

// ServerOption configures a Server
type ServerOption func(*serverOptions)

type serverOptions struct {
	unaryInterceptors  []grpc.UnaryServerInterceptor
	streamInterceptors []grpc.StreamServerInterceptor
	enableInProcess    bool
}

// WithUnaryInterceptor adds a unary interceptor
func WithUnaryInterceptor(i grpc.UnaryServerInterceptor) ServerOption {
	return func(o *serverOptions) {
		o.unaryInterceptors = append(o.unaryInterceptors, i)
	}
}

// WithStreamInterceptor adds a stream interceptor
func WithStreamInterceptor(i grpc.StreamServerInterceptor) ServerOption {
	return func(o *serverOptions) {
		o.streamInterceptors = append(o.streamInterceptors, i)
	}
}

// WithInProcess enables in-process gRPC connections via bufconn
func WithInProcess() ServerOption {
	return func(o *serverOptions) {
		o.enableInProcess = true
	}
}

// NewServer creates a new gRPC server with sensible defaults
func NewServer(opts ...ServerOption) *Server {
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

	s := &Server{
		grpcServer:       grpcServer,
		inProcessEnabled: options.enableInProcess,
	}

	// Create bufconn listener for in-process connections if enabled
	if s.inProcessEnabled {
		s.bufListener = bufconn.Listen(1024 * 1024) // 1MB buffer
		log.Debug().Msg("In-process gRPC support enabled")
	}

	return s
}

// GRPCServer returns the underlying gRPC server for service registration
func (s *Server) GRPCServer() *grpc.Server {
	return s.grpcServer
}

// StartInProcess starts serving in-process requests via bufconn.
// This must be called before Start() to enable in-process connections.
// This is automatically called by Start() if WithInProcess() was set.
func (s *Server) StartInProcess() error {
	if !s.inProcessEnabled || s.bufListener == nil {
		return fmt.Errorf("in-process support not enabled - use WithInProcess() when creating server")
	}

	go func() {
		log.Debug().Msg("Starting in-process gRPC server on bufconn")
		if err := s.grpcServer.Serve(s.bufListener); err != nil {
			log.Error().Err(err).Msg("In-process gRPC server stopped")
		}
	}()

	return nil
}

// Start starts the gRPC server on the given port for network connections.
// Note: If in-process support is enabled, you must call StartInProcess() first
// before calling Start().
func (s *Server) Start(port int) error {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", port, err)
	}

	s.listener = listener
	s.port = port

	log.Info().Int("port", port).Msg("Starting gRPC network server")

	// Serve on network listener (this blocks)
	if err := s.grpcServer.Serve(listener); err != nil {
		return fmt.Errorf("failed to serve gRPC: %w", err)
	}

	return nil
}

// Stop gracefully stops the gRPC server
func (s *Server) Stop() {
	log.Info().Msg("Stopping gRPC server")
	s.grpcServer.GracefulStop()
}

// Port returns the port the server is listening on
func (s *Server) Port() int {
	return s.port
}

// loggingUnaryInterceptor logs all unary RPC calls
func loggingUnaryInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	start := time.Now()

	// Call handler
	resp, err := handler(ctx, req)

	// Log result
	duration := time.Since(start)
	if err != nil {
		st, _ := status.FromError(err)
		log.Error().
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Str("code", st.Code().String()).
			Str("error", st.Message()).
			Msg("gRPC call failed")
	} else {
		log.Info().
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Msg("gRPC call succeeded")
	}

	return resp, err
}

// loggingStreamInterceptor logs all stream RPC calls
func loggingStreamInterceptor(
	srv interface{},
	ss grpc.ServerStream,
	info *grpc.StreamServerInfo,
	handler grpc.StreamHandler,
) error {
	start := time.Now()

	// Call handler
	err := handler(srv, ss)

	// Log result
	duration := time.Since(start)
	if err != nil {
		st, _ := status.FromError(err)
		log.Error().
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Str("code", st.Code().String()).
			Str("error", st.Message()).
			Msg("gRPC stream call failed")
	} else {
		log.Info().
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Msg("gRPC stream call succeeded")
	}

	return err
}

// WrapError wraps an error with an appropriate gRPC status code
func WrapError(err error, code codes.Code, message string) error {
	if err == nil {
		return nil
	}
	return status.Errorf(code, "%s: %v", message, err)
}

// NotFoundError returns a gRPC NOT_FOUND error
func NotFoundError(resource string, id string) error {
	return status.Errorf(codes.NotFound, "%s not found: %s", resource, id)
}

// InvalidArgumentError returns a gRPC INVALID_ARGUMENT error
func InvalidArgumentError(message string) error {
	return status.Error(codes.InvalidArgument, message)
}

// InternalError returns a gRPC INTERNAL error
func InternalError(err error, message string) error {
	return status.Errorf(codes.Internal, "%s: %v", message, err)
}

// AlreadyExistsError returns a gRPC ALREADY_EXISTS error
func AlreadyExistsError(resource string, id string) error {
	return status.Errorf(codes.AlreadyExists, "%s already exists: %s", resource, id)
}

// NewInProcessConnection creates a new gRPC client connection to this server
// using the in-process bufconn listener. This connection goes through the full
// gRPC stack with all interceptors, but without network overhead.
//
// This method can only be called if the server was created with WithInProcess().
//
// The caller is responsible for closing the connection when done.
func (s *Server) NewInProcessConnection(ctx context.Context) (*grpc.ClientConn, error) {
	if !s.inProcessEnabled || s.bufListener == nil {
		return nil, fmt.Errorf("in-process support not enabled - use WithInProcess() when creating server")
	}

	// Create dialer that connects to the bufconn listener
	bufDialer := func(context.Context, string) (net.Conn, error) {
		return s.bufListener.Dial()
	}

	conn, err := grpc.DialContext(
		ctx,
		"bufnet",
		grpc.WithContextDialer(bufDialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create in-process connection: %w", err)
	}

	log.Debug().Msg("Created in-process gRPC client connection")
	return conn, nil
}

// Package grpc provides gRPC server utilities for Stigmer services
package grpc

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

// Server wraps a gRPC server with lifecycle management and in-process support
type Server struct {
	grpcServer       *grpc.Server
	httpServer       *http.Server
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

		// Transport-level keepalive for connection health.
		//
		// Enforcement policy: permit client keepalive PINGs as frequent as
		// every 5 seconds. Without this, gRPC may reject frequent client
		// PINGs with a GOAWAY frame.
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             5 * time.Second, // Allow client PINGs >= 5s apart
			PermitWithoutStream: false,           // Only when active streams exist
		}),

		// Server-initiated keepalive: detect dead clients on long-lived
		// streams (e.g., execution subscribe). If a client disappears
		// without a clean close, the server detects it within Time+Timeout
		// and releases the stream resources.
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    15 * time.Second, // Send PING every 15s on idle connections
			Timeout: 5 * time.Second,  // Wait 5s for PING response
		}),
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

// StartHTTP starts a unified HTTP server on the given port that multiplexes
// native gRPC (HTTP/2) and an arbitrary HTTP handler on the same port.
//
// h2c (HTTP/2 cleartext) is used so native gRPC clients can speak HTTP/2
// without TLS, while HTTP/1.1 clients (e.g. gRPC-Web from browsers) are
// also accepted.
//
// The provided handler receives ALL incoming requests. It is the caller's
// responsibility to route between gRPC (via s.GRPCServer().ServeHTTP) and
// other HTTP traffic (e.g. gRPC-Web wrapper, static files).
//
// This method blocks until the server is stopped via Stop().
func (s *Server) StartHTTP(port int, handler http.Handler) error {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", port, err)
	}

	s.listener = listener
	s.port = port

	h2cHandler := h2c.NewHandler(handler, &http2.Server{})

	s.httpServer = &http.Server{Handler: h2cHandler}

	log.Info().Int("port", port).Msg("Starting gRPC+HTTP server with h2c")

	if err := s.httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("failed to serve: %w", err)
	}

	return nil
}

// IsGRPCRequest reports whether an HTTP request carries a native gRPC call.
// Use this in the handler passed to StartHTTP to route gRPC traffic to
// s.GRPCServer().ServeHTTP.
func IsGRPCRequest(r *http.Request) bool {
	return r.ProtoMajor == 2 && strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc")
}

// Stop gracefully stops the gRPC server. If the server was started with
// StartHTTP, the HTTP server is shut down first.
func (s *Server) Stop() {
	log.Info().Msg("Stopping gRPC server")

	if s.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := s.httpServer.Shutdown(ctx); err != nil {
			log.Warn().Err(err).Msg("HTTP server shutdown error, forcing close")
			s.httpServer.Close()
		}
	}

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

		// Use appropriate log level based on error code
		// NOT_FOUND is often expected (e.g., ExecutionContext in OSS)
		// and should not pollute error logs
		logEvent := log.Debug()
		logMsg := "gRPC call returned not found"

		switch st.Code() {
		case codes.NotFound:
			// NOT_FOUND is expected in many cases - use debug level
			logEvent = log.Debug()
			logMsg = "gRPC call returned not found"
		case codes.AlreadyExists:
			// ALREADY_EXISTS can be expected for idempotent creates
			logEvent = log.Debug()
			logMsg = "gRPC call returned already exists"
		case codes.InvalidArgument, codes.FailedPrecondition:
			// Client errors - use warn level
			logEvent = log.Warn()
			logMsg = "gRPC call failed with client error"
		default:
			// All other errors - use error level
			logEvent = log.Error()
			logMsg = "gRPC call failed"
		}

		logEvent.
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Str("code", st.Code().String()).
			Str("error", st.Message()).
			Msg(logMsg)
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

		// Use appropriate log level based on error code
		logEvent := log.Debug()
		logMsg := "gRPC stream call returned not found"

		switch st.Code() {
		case codes.NotFound:
			logEvent = log.Debug()
			logMsg = "gRPC stream call returned not found"
		case codes.AlreadyExists:
			logEvent = log.Debug()
			logMsg = "gRPC stream call returned already exists"
		case codes.InvalidArgument, codes.FailedPrecondition:
			logEvent = log.Warn()
			logMsg = "gRPC stream call failed with client error"
		default:
			logEvent = log.Error()
			logMsg = "gRPC stream call failed"
		}

		logEvent.
			Str("method", info.FullMethod).
			Dur("duration_ms", duration).
			Str("code", st.Code().String()).
			Str("error", st.Message()).
			Msg(logMsg)
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

// InvalidArgumentError returns a gRPC INVALID_ARGUMENT error with format string support
func InvalidArgumentError(format string, args ...interface{}) error {
	if len(args) == 0 {
		return status.Error(codes.InvalidArgument, format)
	}
	return status.Errorf(codes.InvalidArgument, format, args...)
}

// InternalError returns a gRPC INTERNAL error
func InternalError(err error, message string) error {
	return status.Errorf(codes.Internal, "%s: %v", message, err)
}

// AlreadyExistsError returns a gRPC ALREADY_EXISTS error
func AlreadyExistsError(resource string, id string) error {
	return status.Errorf(codes.AlreadyExists, "%s already exists: %s", resource, id)
}

// FailedPreconditionError returns a gRPC FAILED_PRECONDITION error with format string support.
// Use this when the system is not in a state required for the operation to execute.
func FailedPreconditionError(format string, args ...interface{}) error {
	if len(args) == 0 {
		return status.Error(codes.FailedPrecondition, format)
	}
	return status.Errorf(codes.FailedPrecondition, format, args...)
}

// UnavailableError returns a gRPC UNAVAILABLE error with format string support.
// Use this when a service is temporarily unavailable (e.g., Temporal not reachable).
func UnavailableError(format string, args ...interface{}) error {
	if len(args) == 0 {
		return status.Error(codes.Unavailable, format)
	}
	return status.Errorf(codes.Unavailable, format, args...)
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

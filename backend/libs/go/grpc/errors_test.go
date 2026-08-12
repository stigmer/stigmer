package grpc

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

// TestInternalError_WireMessageIsSanitized pins the information-disclosure
// contract from stigmer/stigmer#478: the status description — the part gRPC
// sends to clients — carries ONLY the static public message, never the
// underlying cause (which can hold storage-engine detail or filesystem
// paths, and reaches unauthenticated visitors on anonymous surfaces such as
// getSharedProfile).
func TestInternalError_WireMessageIsSanitized(t *testing.T) {
	cause := errors.New("bbolt: /var/lib/stigmer/store.db corrupted")
	err := InternalError(cause, "failed to list agent share resources")

	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected InternalError to resolve to a gRPC status")
	}
	if st.Code() != codes.Internal {
		t.Errorf("code = %s, want Internal", st.Code())
	}
	if st.Message() != "failed to list agent share resources" {
		t.Errorf("wire message = %q, want only the public message", st.Message())
	}
	if strings.Contains(st.Message(), "bbolt") || strings.Contains(st.Message(), "/var/lib") {
		t.Errorf("wire message must not carry the cause, got %q", st.Message())
	}
}

// TestInternalError_CauseStaysReachableServerSide verifies the other half of
// the contract: sanitization must not lose the cause for server-side code.
// errors.Is sees through the wrapper, and Error() renders the full
// "message: cause" form that the transport logging interceptors record.
func TestInternalError_CauseStaysReachableServerSide(t *testing.T) {
	cause := errors.New("bbolt: page 42 checksum mismatch")
	err := InternalError(cause, "failed to load resource")

	if !errors.Is(err, cause) {
		t.Error("errors.Is must reach the cause through the sanitized wrapper")
	}
	if got := err.Error(); !strings.Contains(got, "failed to load resource") || !strings.Contains(got, "bbolt") {
		t.Errorf("Error() = %q, want message and cause together for server logs", got)
	}
}

// TestInternalError_WireLevelNegativeControl proves the sanitization on the
// real wire: a full grpc-go round trip over the in-process bufconn transport,
// through the standard interceptor chain, must deliver the client only the
// public message. This pins grpc-go's status serialization (GRPCStatus
// resolution) against future library upgrades — the negative control for
// stigmer/stigmer#478.
func TestInternalError_WireLevelNegativeControl(t *testing.T) {
	cause := errors.New("bbolt: /var/lib/stigmer/store.db corrupted")
	failingInterceptor := func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		return nil, InternalError(cause, "failed to list agent share resources")
	}

	server := NewServer(WithInProcess(), WithUnaryInterceptor(failingInterceptor))
	if err := server.StartInProcess(); err != nil {
		t.Fatalf("failed to start in-process server: %v", err)
	}
	defer server.Stop()

	conn, err := server.NewInProcessConnection(context.Background())
	if err != nil {
		t.Fatalf("failed to create in-process connection: %v", err)
	}
	defer conn.Close()

	_, err = healthpb.NewHealthClient(conn).Check(context.Background(), &healthpb.HealthCheckRequest{})
	if err == nil {
		t.Fatal("expected the injected internal error to reach the client")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected a gRPC status from the client-observed error, got %v", err)
	}
	if st.Code() != codes.Internal {
		t.Errorf("client-observed code = %s, want Internal", st.Code())
	}
	if st.Message() != "failed to list agent share resources" {
		t.Errorf("client-observed message = %q, want only the public message", st.Message())
	}
	if strings.Contains(st.Message(), "bbolt") || strings.Contains(st.Message(), "/var/lib") {
		t.Errorf("client must never see the cause, got %q", st.Message())
	}
}

// TestLoggingUnaryInterceptor_CauseInLogNotOnWire verifies the split the
// sanitization depends on: the transport boundary log line carries the full
// operator detail (via err.Error()) while the status returned to the
// transport stays sanitized. If the interceptor ever regresses to logging
// st.Message(), this fails — operators would silently lose every internal
// cause.
func TestLoggingUnaryInterceptor_CauseInLogNotOnWire(t *testing.T) {
	var buf bytes.Buffer
	origLogger := log.Logger
	log.Logger = zerolog.New(&buf)
	t.Cleanup(func() { log.Logger = origLogger })

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return nil, InternalError(
			errors.New("bbolt: page 42 checksum mismatch"),
			"failed to list agent share resources",
		)
	}

	_, err := loggingUnaryInterceptor(
		context.Background(),
		nil,
		&grpc.UnaryServerInfo{FullMethod: "/test.Service/Method"},
		handler,
	)
	if err == nil {
		t.Fatal("expected the handler error to propagate")
	}

	st, _ := status.FromError(err)
	if strings.Contains(st.Message(), "bbolt") {
		t.Errorf("returned status must stay sanitized, got %q", st.Message())
	}

	logged := buf.String()
	if !strings.Contains(logged, "bbolt: page 42 checksum mismatch") {
		t.Errorf("boundary log must preserve the cause for operators, got %q", logged)
	}
	if !strings.Contains(logged, "failed to list agent share resources") {
		t.Errorf("boundary log must carry the public message too, got %q", logged)
	}
}

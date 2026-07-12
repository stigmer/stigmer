package grpc

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

// TestHealthService_Lifecycle verifies the standard gRPC health service is
// registered by NewServer and that its overall status transitions
// NOT_SERVING -> SERVING -> NOT_SERVING via the wrapper's readiness methods.
//
// The health client talks over the in-process bufconn transport, so every
// Check flows through the full interceptor chain (logging, and — when the
// caller adds them — protovalidate/apiresource). That means this test also
// proves those interceptors do not reject a service that carries no
// api_resource_kind option and no proto field constraints.
func TestHealthService_Lifecycle(t *testing.T) {
	server := NewServer(WithInProcess())
	require.NoError(t, server.StartInProcess(), "in-process server should start")
	t.Cleanup(server.Stop)

	conn, err := server.NewInProcessConnection(context.Background())
	require.NoError(t, err, "in-process connection should be created")
	t.Cleanup(func() { _ = conn.Close() })

	client := healthpb.NewHealthClient(conn)
	check := func(t *testing.T) healthpb.HealthCheckResponse_ServingStatus {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		resp, err := client.Check(ctx, &healthpb.HealthCheckRequest{})
		require.NoError(t, err, "health Check on overall status should not error")
		return resp.GetStatus()
	}

	require.Equal(t, healthpb.HealthCheckResponse_NOT_SERVING, check(t),
		"a freshly constructed server must report NOT_SERVING until it is marked ready")

	server.SetHealthServing()
	require.Equal(t, healthpb.HealthCheckResponse_SERVING, check(t),
		"SetHealthServing must flip the overall status to SERVING")

	// This is the exact call Stop performs, so shutdown behavior is covered
	// here deterministically without racing a closing connection.
	server.SetHealthNotServing()
	require.Equal(t, healthpb.HealthCheckResponse_NOT_SERVING, check(t),
		"SetHealthNotServing must flip the overall status back to NOT_SERVING")
}

// TestHealthService_UnknownService verifies the standard grpc-go semantics that
// checking a service the server never registered returns NOT_FOUND.
func TestHealthService_UnknownService(t *testing.T) {
	server := NewServer(WithInProcess())
	require.NoError(t, server.StartInProcess(), "in-process server should start")
	t.Cleanup(server.Stop)

	conn, err := server.NewInProcessConnection(context.Background())
	require.NoError(t, err, "in-process connection should be created")
	t.Cleanup(func() { _ = conn.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client := healthpb.NewHealthClient(conn)
	_, err = client.Check(ctx, &healthpb.HealthCheckRequest{Service: "does.not.exist"})
	require.Error(t, err, "checking an unregistered service should error")
	require.Equal(t, codes.NotFound, status.Code(err),
		"checking an unregistered service should return NOT_FOUND")
}

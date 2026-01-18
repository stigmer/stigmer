package grpc

import (
	"context"
	"testing"

	"google.golang.org/grpc"
)

// TestInProcessConnection verifies that in-process gRPC connections work correctly
func TestInProcessConnection(t *testing.T) {
	// Create test interceptor (would be called when making actual RPC)
	testInterceptor := func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		// Interceptor logic would execute here
		return handler(ctx, req)
	}

	// Create server with in-process support and test interceptor
	server := NewServer(
		WithInProcess(),
		WithUnaryInterceptor(testInterceptor),
	)

	if !server.inProcessEnabled {
		t.Fatal("In-process support should be enabled")
	}

	if server.bufListener == nil {
		t.Fatal("bufListener should be created when WithInProcess() is used")
	}

	// Start in-process server
	err := server.StartInProcess()
	if err != nil {
		t.Fatalf("Failed to start in-process server: %v", err)
	}
	defer server.Stop()

	// Create in-process connection
	conn, err := server.NewInProcessConnection(context.Background())
	if err != nil {
		t.Fatalf("Failed to create in-process connection: %v", err)
	}
	defer conn.Close()

	// Note: Without registering actual services, we can only test that:
	// 1. Server creation with WithInProcess() works
	// 2. bufListener is created
	// 3. StartInProcess() succeeds
	// 4. NewInProcessConnection() creates a valid connection
	//
	// Full interceptor testing requires registering a test service,
	// which is done in integration tests.

	t.Log("In-process gRPC setup successful")
}

// TestInProcessConnectionWithoutEnable verifies error when in-process not enabled
func TestInProcessConnectionWithoutEnable(t *testing.T) {
	// Create server WITHOUT in-process support
	server := NewServer()

	if server.inProcessEnabled {
		t.Fatal("In-process support should NOT be enabled")
	}

	// Try to create in-process connection (should fail)
	_, err := server.NewInProcessConnection(context.Background())
	if err == nil {
		t.Fatal("Expected error when creating in-process connection without WithInProcess()")
	}

	expectedMsg := "in-process support not enabled"
	if err.Error()[:len(expectedMsg)] != expectedMsg {
		t.Fatalf("Expected error message to start with '%s', got: %v", expectedMsg, err)
	}

	t.Log("Correctly rejected in-process connection when not enabled")
}

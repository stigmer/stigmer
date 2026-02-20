package domains

import (
	"context"
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	"google.golang.org/grpc"
)

func TestWithConnection_success(t *testing.T) {
	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {})
	ctx := auth.WithAPIKey(context.Background(), "test-key")

	result, err := WithConnection(ctx, addr, func(rpcCtx context.Context, conn *grpc.ClientConn) (string, error) {
		if conn == nil {
			t.Error("conn is nil")
		}
		if _, ok := rpcCtx.Deadline(); !ok {
			t.Error("context has no deadline")
		}
		return "hello", nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "hello" {
		t.Errorf("result = %q, want %q", result, "hello")
	}
}

func TestWithConnection_fnError(t *testing.T) {
	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {})
	ctx := auth.WithAPIKey(context.Background(), "test-key")

	_, err := WithConnection(ctx, addr, func(_ context.Context, _ *grpc.ClientConn) (string, error) {
		return "", fmt.Errorf("something went wrong")
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "something went wrong" {
		t.Errorf("error = %q, want %q", err.Error(), "something went wrong")
	}
}

func TestWithConnection_fnResultPassthrough(t *testing.T) {
	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {})
	ctx := auth.WithAPIKey(context.Background(), "test-key")

	result, err := WithConnection(ctx, addr, func(_ context.Context, _ *grpc.ClientConn) (string, error) {
		return `{"status":"ok"}`, nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != `{"status":"ok"}` {
		t.Errorf("result = %q, want %q", result, `{"status":"ok"}`)
	}
}

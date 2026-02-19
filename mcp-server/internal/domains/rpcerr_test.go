package domains

import (
	"errors"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRPCError_gRPCCodes(t *testing.T) {
	const desc = `agent "reviewer" in org "acme"`

	tests := []struct {
		name     string
		code     codes.Code
		grpcMsg  string
		wantSub  string // substring that must appear in the returned error
	}{
		{
			name:    "NotFound",
			code:    codes.NotFound,
			grpcMsg: "agent not found",
			wantSub: `agent "reviewer" in org "acme" not found`,
		},
		{
			name:    "PermissionDenied",
			code:    codes.PermissionDenied,
			grpcMsg: "caller lacks permission",
			wantSub: "Permission denied",
		},
		{
			name:    "Unauthenticated",
			code:    codes.Unauthenticated,
			grpcMsg: "invalid token",
			wantSub: "Authentication failed",
		},
		{
			name:    "Unavailable",
			code:    codes.Unavailable,
			grpcMsg: "connection refused",
			wantSub: "unavailable",
		},
		{
			name:    "DeadlineExceeded",
			code:    codes.DeadlineExceeded,
			grpcMsg: "context deadline exceeded",
			wantSub: "timed out",
		},
		{
			name:    "InvalidArgument passes through gRPC message",
			code:    codes.InvalidArgument,
			grpcMsg: "org must not be empty",
			wantSub: "org must not be empty",
		},
		{
			name:    "Unknown code falls through to default",
			code:    codes.Internal,
			grpcMsg: "internal server error",
			wantSub: "unexpected error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			grpcErr := status.Error(tt.code, tt.grpcMsg)
			got := RPCError(grpcErr, desc)
			if got == nil {
				t.Fatal("RPCError returned nil")
			}
			if !strings.Contains(got.Error(), tt.wantSub) {
				t.Errorf("RPCError() = %q, want substring %q", got.Error(), tt.wantSub)
			}
		})
	}
}

func TestRPCError_nonGRPCError(t *testing.T) {
	plainErr := errors.New("connection reset by peer")
	got := RPCError(plainErr, "skill in org acme")
	if got == nil {
		t.Fatal("RPCError returned nil")
	}
	if !strings.Contains(got.Error(), "unexpected error") {
		t.Errorf("RPCError() = %q, want substring %q", got.Error(), "unexpected error")
	}
}

func TestClassifyCode_exhaustive(t *testing.T) {
	const desc = "workflow in org test"

	got := classifyCode(codes.NotFound, desc, "not found")
	if !strings.HasPrefix(got, desc) {
		t.Errorf("NotFound message should start with resource desc, got %q", got)
	}

	got = classifyCode(codes.Unauthenticated, desc, "bad creds")
	if strings.Contains(got, desc) {
		t.Errorf("Unauthenticated message should not include resource desc, got %q", got)
	}

	got = classifyCode(codes.InvalidArgument, desc, "page_size must be positive")
	if got != "page_size must be positive" {
		t.Errorf("InvalidArgument should pass through gRPC message, got %q", got)
	}
}

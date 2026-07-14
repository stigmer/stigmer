package stigmer

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWrapErr_NilError(t *testing.T) {
	if err := gen.WrapErr(nil); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestWrapErr_NonGRPCError(t *testing.T) {
	original := fmt.Errorf("plain error")
	wrapped := gen.WrapErr(original)
	if wrapped != original {
		t.Fatalf("expected original error, got %v", wrapped)
	}
}

func TestWrapErr_GRPCStatusCodes(t *testing.T) {
	tests := []struct {
		grpcCode codes.Code
		sdkCode  ErrorCode
	}{
		{codes.NotFound, CodeNotFound},
		{codes.PermissionDenied, CodePermissionDenied},
		{codes.Unauthenticated, CodeUnauthenticated},
		{codes.InvalidArgument, CodeInvalidArgument},
		{codes.AlreadyExists, CodeAlreadyExists},
		{codes.ResourceExhausted, CodeResourceExhausted},
		{codes.FailedPrecondition, CodeFailedPrecondition},
		{codes.Internal, CodeInternal},
		{codes.Unavailable, CodeUnavailable},
		{codes.Unknown, CodeUnknown},
	}

	for _, tc := range tests {
		t.Run(tc.grpcCode.String(), func(t *testing.T) {
			grpcErr := status.Error(tc.grpcCode, "test message")
			wrapped := gen.WrapErr(grpcErr)

			var sErr *Error
			if !errors.As(wrapped, &sErr) {
				t.Fatalf("expected *Error, got %T", wrapped)
			}
			if sErr.Code != tc.sdkCode {
				t.Errorf("expected code %d, got %d", tc.sdkCode, sErr.Code)
			}
			if sErr.GRPCCode != tc.grpcCode {
				t.Errorf("expected grpc code %v, got %v", tc.grpcCode, sErr.GRPCCode)
			}
			if sErr.Message != "test message" {
				t.Errorf("expected message %q, got %q", "test message", sErr.Message)
			}
		})
	}
}

func TestIsNotFound(t *testing.T) {
	grpcErr := status.Error(codes.NotFound, "not found")
	if !IsNotFound(gen.WrapErr(grpcErr)) {
		t.Fatal("expected IsNotFound to be true")
	}
	if IsNotFound(fmt.Errorf("plain error")) {
		t.Fatal("expected IsNotFound to be false for plain error")
	}
}

func TestIsUnauthenticated(t *testing.T) {
	grpcErr := status.Error(codes.Unauthenticated, "bad token")
	if !IsUnauthenticated(gen.WrapErr(grpcErr)) {
		t.Fatal("expected IsUnauthenticated to be true")
	}
}

func TestIsPermissionDenied(t *testing.T) {
	grpcErr := status.Error(codes.PermissionDenied, "access denied")
	if !IsPermissionDenied(gen.WrapErr(grpcErr)) {
		t.Fatal("expected IsPermissionDenied to be true")
	}
}

func TestErrorString(t *testing.T) {
	err := &Error{Code: CodeNotFound, Message: "agent not found", GRPCCode: codes.NotFound}
	s := err.Error()
	if s != "stigmer: agent not found (code=5)" {
		t.Errorf("unexpected error string: %s", s)
	}
}

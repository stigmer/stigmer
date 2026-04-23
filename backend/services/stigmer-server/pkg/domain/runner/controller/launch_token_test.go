package runner

import (
	"context"
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreateLaunchToken_ReturnsUnimplemented(t *testing.T) {
	controller := &RunnerController{}

	resp, err := controller.CreateLaunchToken(context.Background(), &runnerv1.CreateLaunchTokenRequest{
		Org: "test-org",
	})

	if resp != nil {
		t.Errorf("expected nil response, got %v", resp)
	}
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.Unimplemented {
		t.Errorf("expected UNIMPLEMENTED, got %v", st.Code())
	}
	if st.Message() == "" {
		t.Error("expected descriptive error message, got empty string")
	}
}

func TestExchangeLaunchToken_ReturnsUnimplemented(t *testing.T) {
	controller := &RunnerController{}

	resp, err := controller.ExchangeLaunchToken(context.Background(), &runnerv1.ExchangeLaunchTokenRequest{
		Token: "test-token",
	})

	if resp != nil {
		t.Errorf("expected nil response, got %v", resp)
	}
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.Unimplemented {
		t.Errorf("expected UNIMPLEMENTED, got %v", st.Code())
	}
	if st.Message() == "" {
		t.Error("expected descriptive error message, got empty string")
	}
}

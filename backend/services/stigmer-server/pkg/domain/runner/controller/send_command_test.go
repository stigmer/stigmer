package runner

import (
	"context"
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSendCommand_MissingRunnerID(t *testing.T) {
	ctrl := newTestController(t)

	_, err := ctrl.SendCommand(context.Background(), &runnerv1.RunnerSendCommandInput{})

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestSendCommand_MissingCommand(t *testing.T) {
	ctrl := newTestController(t)

	_, err := ctrl.SendCommand(context.Background(), &runnerv1.RunnerSendCommandInput{
		RunnerId: "runner-1",
	})

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestSendCommand_RunnerNotFound(t *testing.T) {
	ctrl := newTestController(t)

	_, err := ctrl.SendCommand(context.Background(), &runnerv1.RunnerSendCommandInput{
		RunnerId: "nonexistent",
		Command: &runnerv1.RunnerSendCommandInput_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	})

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.NotFound {
		t.Errorf("expected NOT_FOUND, got %v", st.Code())
	}
}

func TestSendCommand_PhaseGate(t *testing.T) {
	tests := []struct {
		name  string
		phase runnerv1.RunnerPhase
	}{
		{"STOPPED rejects", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED},
		{"PENDING rejects", runnerv1.RunnerPhase_RUNNER_PHASE_PENDING},
		{"FAILED rejects", runnerv1.RunnerPhase_RUNNER_PHASE_FAILED},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := newTestController(t)
			saveRunner(t, ctrl, "runner-1", tt.phase)

			_, err := ctrl.SendCommand(context.Background(), &runnerv1.RunnerSendCommandInput{
				RunnerId: "runner-1",
				Command: &runnerv1.RunnerSendCommandInput_ListDirectory{
					ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
				},
			})

			st, ok := status.FromError(err)
			if !ok {
				t.Fatalf("expected gRPC status error, got %T: %v", err, err)
			}
			if st.Code() != codes.FailedPrecondition {
				t.Errorf("expected FAILED_PRECONDITION, got %v", st.Code())
			}
		})
	}
}

func TestBuildCommandRequest_ListDirectory(t *testing.T) {
	input := &runnerv1.RunnerSendCommandInput{
		RunnerId: "runner-1",
		Command: &runnerv1.RunnerSendCommandInput_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/home/user"},
		},
	}

	req := buildCommandRequest(input)

	if req.GetRequestId() == "" {
		t.Error("expected request_id to be generated")
	}

	listDir := req.GetListDirectory()
	if listDir == nil {
		t.Fatal("expected ListDirectory command in request")
	}
	if listDir.GetPath() != "/home/user" {
		t.Errorf("expected path '/home/user', got %q", listDir.GetPath())
	}
}

func TestBuildCommandRequest_GeneratesUniqueIDs(t *testing.T) {
	input := &runnerv1.RunnerSendCommandInput{
		Command: &runnerv1.RunnerSendCommandInput_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	}

	req1 := buildCommandRequest(input)
	req2 := buildCommandRequest(input)

	if req1.GetRequestId() == req2.GetRequestId() {
		t.Error("expected unique request_ids, got identical values")
	}
}

package runner

import (
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestApplyHeartbeat_PhaseTransitions(t *testing.T) {
	tests := []struct {
		name          string
		existingPhase runnerv1.RunnerPhase
		reportedPhase runnerv1.RunnerPhase
		wantPhase     runnerv1.RunnerPhase
		wantErr       codes.Code
		wantReactivation bool
	}{
		{
			name:             "PENDING + READY reactivates",
			existingPhase:    runnerv1.RunnerPhase_RUNNER_PHASE_PENDING,
			reportedPhase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantPhase:        runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantReactivation: true,
		},
		{
			name:             "STOPPED + READY reactivates",
			existingPhase:    runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED,
			reportedPhase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantPhase:        runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantReactivation: true,
		},
		{
			name:          "READY + BUSY transitions",
			existingPhase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			reportedPhase: runnerv1.RunnerPhase_RUNNER_PHASE_BUSY,
			wantPhase:     runnerv1.RunnerPhase_RUNNER_PHASE_BUSY,
		},
		{
			name:          "BUSY + READY transitions",
			existingPhase: runnerv1.RunnerPhase_RUNNER_PHASE_BUSY,
			reportedPhase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantPhase:     runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		},
		{
			name:          "READY stays READY",
			existingPhase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			reportedPhase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantPhase:     runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		},
		{
			name:          "FAILED rejects heartbeat",
			existingPhase: runnerv1.RunnerPhase_RUNNER_PHASE_FAILED,
			reportedPhase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			wantErr:       codes.FailedPrecondition,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &runnerv1.Runner{
				Status: &runnerv1.RunnerStatus{
					Phase: tt.existingPhase,
				},
			}

			heartbeat := &runnerv1.RunnerHeartbeat{
				RunnerId: "test-runner",
				Phase:    tt.reportedPhase,
			}

			err := applyHeartbeat(runner, heartbeat)

			if tt.wantErr != 0 {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				st, ok := status.FromError(err)
				if !ok {
					t.Fatalf("expected gRPC status error, got %T: %v", err, err)
				}
				if st.Code() != tt.wantErr {
					t.Errorf("expected %v, got %v", tt.wantErr, st.Code())
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if runner.GetStatus().GetPhase() != tt.wantPhase {
				t.Errorf("expected phase %v, got %v", tt.wantPhase, runner.GetStatus().GetPhase())
			}

			if tt.wantReactivation {
				if runner.GetStatus().GetStartedAt() == nil {
					t.Error("expected started_at to be set on reactivation")
				}
				if runner.GetStatus().GetStoppedAt() != nil {
					t.Error("expected stopped_at to be cleared on reactivation")
				}
			}
		})
	}
}

func TestApplyHeartbeat_PropagatesConnectionInfo(t *testing.T) {
	runner := &runnerv1.Runner{
		Status: &runnerv1.RunnerStatus{
			Phase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		},
	}

	connInfo := &runnerv1.RunnerConnectionInfo{
		Hostname: "my-host",
		Os:       "linux",
		Arch:     "amd64",
	}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId:       "test-runner",
		Phase:          runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		ConnectionInfo: connInfo,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := runner.GetStatus().GetConnectionInfo()
	if got == nil {
		t.Fatal("expected connection_info to be set")
	}
	if got.GetHostname() != "my-host" {
		t.Errorf("expected hostname 'my-host', got %q", got.GetHostname())
	}
	if got.GetOs() != "linux" {
		t.Errorf("expected os 'linux', got %q", got.GetOs())
	}
	if got.GetArch() != "amd64" {
		t.Errorf("expected arch 'amd64', got %q", got.GetArch())
	}
}

func TestApplyHeartbeat_PropagatesCurrentExecutions(t *testing.T) {
	runner := &runnerv1.Runner{
		Status: &runnerv1.RunnerStatus{
			Phase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		},
	}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId:          "test-runner",
		Phase:             runnerv1.RunnerPhase_RUNNER_PHASE_BUSY,
		CurrentExecutions: 3,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if runner.GetStatus().GetCurrentExecutions() != 3 {
		t.Errorf("expected current_executions=3, got %d", runner.GetStatus().GetCurrentExecutions())
	}
}

func TestApplyHeartbeat_UpdatesLastHeartbeatAt(t *testing.T) {
	runner := &runnerv1.Runner{
		Status: &runnerv1.RunnerStatus{
			Phase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
		},
	}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "test-runner",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if runner.GetStatus().GetLastHeartbeatAt() == nil {
		t.Error("expected last_heartbeat_at to be set")
	}
}

func TestApplyHeartbeat_NilConnectionInfo_PreservesExisting(t *testing.T) {
	existingConn := &runnerv1.RunnerConnectionInfo{
		Hostname: "old-host",
	}

	runner := &runnerv1.Runner{
		Status: &runnerv1.RunnerStatus{
			Phase:          runnerv1.RunnerPhase_RUNNER_PHASE_READY,
			ConnectionInfo: existingConn,
		},
	}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "test-runner",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := runner.GetStatus().GetConnectionInfo()
	if got == nil {
		t.Fatal("expected connection_info to be preserved")
	}
	if got.GetHostname() != "old-host" {
		t.Errorf("expected preserved hostname 'old-host', got %q", got.GetHostname())
	}
}

func TestApplyHeartbeat_ReactivationClearsStoppedAt(t *testing.T) {
	runner := &runnerv1.Runner{
		Status: &runnerv1.RunnerStatus{
			Phase:     runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED,
			StoppedAt: timestamppb.Now(),
		},
	}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "test-runner",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if runner.GetStatus().GetStoppedAt() != nil {
		t.Error("expected stopped_at to be cleared on reactivation")
	}
	if runner.GetStatus().GetStartedAt() == nil {
		t.Error("expected started_at to be set on reactivation")
	}
}

func TestApplyHeartbeat_NilExistingStatus(t *testing.T) {
	runner := &runnerv1.Runner{}

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "test-runner",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	if err := applyHeartbeat(runner, heartbeat); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_READY {
		t.Errorf("expected READY, got %v", runner.GetStatus().GetPhase())
	}

	// UNSPECIFIED -> READY is NOT a reactivation (only PENDING/STOPPED trigger it).
	// Nil status with zero-value phase should not set started_at.
	if runner.GetStatus().GetLastHeartbeatAt() == nil {
		t.Error("expected last_heartbeat_at to be set")
	}
}

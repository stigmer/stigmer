package runner

import (
	"context"
	"path/filepath"
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func newTestController(t *testing.T) *RunnerController {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.sqlite")
	s, err := sqlite.NewStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return NewRunnerController(s)
}

func saveRunner(t *testing.T, ctrl *RunnerController, id string, phase runnerv1.RunnerPhase) {
	t.Helper()
	runner := &runnerv1.Runner{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Runner",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: "test-runner",
			Org:  "test-org",
			Slug: "test-runner",
		},
		Status: &runnerv1.RunnerStatus{
			Phase:     phase,
			TaskQueue: "runner:" + id,
		},
	}
	err := ctrl.store.SaveResource(
		context.Background(),
		apiresourcekind.ApiResourceKind_runner,
		id,
		runner,
	)
	if err != nil {
		t.Fatalf("failed to save test runner: %v", err)
	}
}

func TestStop_MissingRunnerID(t *testing.T) {
	ctrl := newTestController(t)

	_, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{})

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestStop_NotFound(t *testing.T) {
	ctrl := newTestController(t)

	_, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{
		RunnerId: "nonexistent",
	})

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.NotFound {
		t.Errorf("expected NOT_FOUND, got %v", st.Code())
	}
}

func TestStop_AlreadyStopped_ReturnsAsIs(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED)

	runner, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{
		RunnerId: "runner-1",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED {
		t.Errorf("expected STOPPED phase, got %v", runner.GetStatus().GetPhase())
	}
}

func TestStop_FailedRunner_ReturnsAsIs(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_FAILED)

	runner, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{
		RunnerId: "runner-1",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
		t.Errorf("expected FAILED phase preserved, got %v", runner.GetStatus().GetPhase())
	}
}

func TestStop_Disconnected_TransitionsToStopped(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_READY)

	runner, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{
		RunnerId: "runner-1",
		Reason:   "test stop",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED {
		t.Errorf("expected STOPPED phase, got %v", runner.GetStatus().GetPhase())
	}
	if runner.GetStatus().GetStoppedAt() == nil {
		t.Error("expected stopped_at to be set")
	}
	if runner.GetStatus().GetStoppedAt().AsTime().IsZero() {
		t.Error("expected non-zero stopped_at timestamp")
	}
}

func TestStop_Connected_SendsCommandAndReturns(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_READY)

	mockStream := &mockBidiStream{}
	ctrl.streamRegistry.Register("runner-1", mockStream)

	// Simulate the runner responding in the background.
	go func() {
		entry, _ := ctrl.streamRegistry.getEntry("runner-1")
		for {
			entry.pendingMu.Lock()
			for id := range entry.pending {
				entry.pendingMu.Unlock()
				ctrl.streamRegistry.DeliverResponse("runner-1", &runnerv1.RunnerCommandResponse{
					RequestId: id,
					Result: &runnerv1.RunnerCommandResponse_Stop{
						Stop: &runnerv1.StopRunnerResponse{},
					},
				})
				return
			}
			entry.pendingMu.Unlock()
		}
	}()

	runner, err := ctrl.Stop(context.Background(), &runnerv1.RunnerStopInput{
		RunnerId: "runner-1",
		Reason:   "user requested",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Runner is returned as-is (still READY); the STOPPED transition is async.
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_READY {
		t.Errorf("expected READY phase (stop is async), got %v", runner.GetStatus().GetPhase())
	}
}

// mockBidiStream satisfies grpc.BidiStreamingServer for testing command dispatch.
type mockBidiStream struct {
	sendFn func(*runnerv1.RunnerStreamServerMessage) error
}

func (m *mockBidiStream) Send(msg *runnerv1.RunnerStreamServerMessage) error {
	if m.sendFn != nil {
		return m.sendFn(msg)
	}
	return nil
}

func (m *mockBidiStream) Recv() (*runnerv1.RunnerStreamClientMessage, error) {
	select {} // block forever; tests don't use recv
}

func (m *mockBidiStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockBidiStream) SendHeader(_ metadata.MD) error  { return nil }
func (m *mockBidiStream) SetTrailer(_ metadata.MD)        {}
func (m *mockBidiStream) Context() context.Context        { return context.Background() }
func (m *mockBidiStream) SendMsg(_ any) error             { return nil }
func (m *mockBidiStream) RecvMsg(_ any) error             { return nil }

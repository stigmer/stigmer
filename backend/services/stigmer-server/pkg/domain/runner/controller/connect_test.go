package runner

import (
	"context"
	"io"
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// connectMockStream extends the test's mockBidiStream with sequenced Recv responses.
type connectMockStream struct {
	messages []*runnerv1.RunnerStreamClientMessage
	recvIdx  int
	ctx      context.Context
	sendFn   func(*runnerv1.RunnerStreamServerMessage) error
}

func (m *connectMockStream) Recv() (*runnerv1.RunnerStreamClientMessage, error) {
	if m.recvIdx >= len(m.messages) {
		return nil, io.EOF
	}
	msg := m.messages[m.recvIdx]
	m.recvIdx++
	return msg, nil
}

func (m *connectMockStream) Send(msg *runnerv1.RunnerStreamServerMessage) error {
	if m.sendFn != nil {
		return m.sendFn(msg)
	}
	return nil
}

func (m *connectMockStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *connectMockStream) SendHeader(_ metadata.MD) error { return nil }
func (m *connectMockStream) SetTrailer(_ metadata.MD)       {}
func (m *connectMockStream) SendMsg(_ any) error            { return nil }
func (m *connectMockStream) RecvMsg(_ any) error            { return nil }

func (m *connectMockStream) Context() context.Context {
	if m.ctx != nil {
		return m.ctx
	}
	return context.Background()
}

// loadRunner reads a runner from the test controller's store.
func loadRunner(t *testing.T, ctrl *RunnerController, id string) *runnerv1.Runner {
	t.Helper()
	runner := &runnerv1.Runner{}
	if err := ctrl.store.GetResource(
		context.Background(),
		apiresourcekind.ApiResourceKind_runner,
		id,
		runner,
	); err != nil {
		t.Fatalf("failed to load runner: %v", err)
	}
	return runner
}

// --- authenticateStream tests ---

func TestAuthenticateStream_FirstMessageNotHeartbeat(t *testing.T) {
	ctrl := newTestController(t)

	stream := &connectMockStream{
		messages: []*runnerv1.RunnerStreamClientMessage{
			{
				Message: &runnerv1.RunnerStreamClientMessage_CommandResponse{
					CommandResponse: &runnerv1.RunnerCommandResponse{RequestId: "req-1"},
				},
			},
		},
	}

	_, err := ctrl.authenticateStream(stream)
	if err == nil {
		t.Fatal("expected error when first message is not a heartbeat")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestAuthenticateStream_EmptyRunnerID(t *testing.T) {
	ctrl := newTestController(t)

	stream := &connectMockStream{
		messages: []*runnerv1.RunnerStreamClientMessage{
			{
				Message: &runnerv1.RunnerStreamClientMessage_Heartbeat{
					Heartbeat: &runnerv1.RunnerHeartbeat{
						Phase: runnerv1.RunnerPhase_RUNNER_PHASE_READY,
					},
				},
			},
		},
	}

	_, err := ctrl.authenticateStream(stream)
	if err == nil {
		t.Fatal("expected error when runner_id is empty")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestAuthenticateStream_RunnerNotFound(t *testing.T) {
	ctrl := newTestController(t)

	stream := &connectMockStream{
		messages: []*runnerv1.RunnerStreamClientMessage{
			{
				Message: &runnerv1.RunnerStreamClientMessage_Heartbeat{
					Heartbeat: &runnerv1.RunnerHeartbeat{
						RunnerId: "nonexistent",
						Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
					},
				},
			},
		},
	}

	_, err := ctrl.authenticateStream(stream)
	if err == nil {
		t.Fatal("expected error when runner does not exist")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.NotFound {
		t.Errorf("expected NOT_FOUND, got %v", st.Code())
	}
}

func TestAuthenticateStream_ValidRunner(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_PENDING)

	stream := &connectMockStream{
		messages: []*runnerv1.RunnerStreamClientMessage{
			{
				Message: &runnerv1.RunnerStreamClientMessage_Heartbeat{
					Heartbeat: &runnerv1.RunnerHeartbeat{
						RunnerId: "runner-1",
						Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
					},
				},
			},
		},
	}

	runnerID, err := ctrl.authenticateStream(stream)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if runnerID != "runner-1" {
		t.Errorf("expected runner_id 'runner-1', got %q", runnerID)
	}
}

func TestAuthenticateStream_StreamClosedImmediately(t *testing.T) {
	ctrl := newTestController(t)

	stream := &connectMockStream{
		messages: nil,
	}

	_, err := ctrl.authenticateStream(stream)
	if err == nil {
		t.Fatal("expected error when stream closes before first message")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

// --- handleHeartbeat tests ---

func TestHandleHeartbeat_RunnerIDMismatch(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_READY)

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "runner-2",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	err := ctrl.handleHeartbeat(context.Background(), "runner-1", heartbeat)
	if err == nil {
		t.Fatal("expected error on runner_id mismatch")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected INVALID_ARGUMENT, got %v", st.Code())
	}
}

func TestHandleHeartbeat_ValidHeartbeat(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_READY)

	ctrl.streamRegistry.Register("runner-1", &mockBidiStream{})

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "runner-1",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	err := ctrl.handleHeartbeat(context.Background(), "runner-1", heartbeat)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHandleHeartbeat_FailedPhaseIsTerminal(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_FAILED)

	heartbeat := &runnerv1.RunnerHeartbeat{
		RunnerId: "runner-1",
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_READY,
	}

	err := ctrl.handleHeartbeat(context.Background(), "runner-1", heartbeat)
	if err == nil {
		t.Fatal("expected terminal error for FAILED runner")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Errorf("expected FAILED_PRECONDITION, got %v", st.Code())
	}
}

// --- handleDisconnect tests ---

func TestHandleDisconnect_ReadyRunnerTransitionsToStopped(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_READY)

	ctrl.streamRegistry.Register("runner-1", &mockBidiStream{})
	ctrl.handleDisconnect("runner-1")

	if ctrl.streamRegistry.IsConnected("runner-1") {
		t.Error("expected stream to be unregistered after disconnect")
	}

	runner := loadRunner(t, ctrl, "runner-1")
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED {
		t.Errorf("expected STOPPED phase after disconnect, got %v", runner.GetStatus().GetPhase())
	}
	if runner.GetStatus().GetStoppedAt() == nil {
		t.Error("expected stopped_at to be set")
	}
}

func TestHandleDisconnect_AlreadyStoppedIsNoOp(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED)

	ctrl.streamRegistry.Register("runner-1", &mockBidiStream{})
	ctrl.handleDisconnect("runner-1")

	runner := loadRunner(t, ctrl, "runner-1")
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED {
		t.Errorf("expected STOPPED phase preserved, got %v", runner.GetStatus().GetPhase())
	}
}

func TestHandleDisconnect_FailedIsNoOp(t *testing.T) {
	ctrl := newTestController(t)
	saveRunner(t, ctrl, "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_FAILED)

	ctrl.streamRegistry.Register("runner-1", &mockBidiStream{})
	ctrl.handleDisconnect("runner-1")

	runner := loadRunner(t, ctrl, "runner-1")
	if runner.GetStatus().GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
		t.Errorf("expected FAILED phase preserved, got %v", runner.GetStatus().GetPhase())
	}
}

// --- recvLoop tests ---

func TestRecvLoop_EOF_ReturnsNil(t *testing.T) {
	ctrl := newTestController(t)

	stream := &connectMockStream{
		messages: nil,
	}

	err := ctrl.recvLoop(stream, "runner-1")
	if err != nil {
		t.Fatalf("expected nil error on EOF, got %v", err)
	}
}

func TestRecvLoop_DeliversCommandResponse(t *testing.T) {
	ctrl := newTestController(t)

	resp := &runnerv1.RunnerCommandResponse{
		RequestId: "req-1",
		Result: &runnerv1.RunnerCommandResponse_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryResponse{ResolvedPath: "/tmp"},
		},
	}

	stream := &connectMockStream{
		messages: []*runnerv1.RunnerStreamClientMessage{
			{
				Message: &runnerv1.RunnerStreamClientMessage_CommandResponse{
					CommandResponse: resp,
				},
			},
		},
	}

	ctrl.streamRegistry.Register("runner-1", &mockBidiStream{})

	err := ctrl.recvLoop(stream, "runner-1")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

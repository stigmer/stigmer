package runner

import (
	"context"
	"testing"
	"time"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestStreamRegistry_RegisterAndIsConnected(t *testing.T) {
	reg := NewStreamRegistry()
	stream := &mockBidiStream{}

	if reg.IsConnected("runner-1") {
		t.Error("expected runner to not be connected before registration")
	}

	reg.Register("runner-1", stream)

	if !reg.IsConnected("runner-1") {
		t.Error("expected runner to be connected after registration")
	}
}

func TestStreamRegistry_UnregisterAndIsConnected(t *testing.T) {
	reg := NewStreamRegistry()
	stream := &mockBidiStream{}

	reg.Register("runner-1", stream)
	reg.Unregister("runner-1")

	if reg.IsConnected("runner-1") {
		t.Error("expected runner to not be connected after unregistration")
	}
}

func TestStreamRegistry_UnregisterIdempotent(t *testing.T) {
	reg := NewStreamRegistry()

	// Unregistering a runner that was never registered should not panic.
	reg.Unregister("nonexistent")

	// Double unregister should not panic.
	reg.Register("runner-1", &mockBidiStream{})
	reg.Unregister("runner-1")
	reg.Unregister("runner-1")
}

func TestStreamRegistry_DuplicateRegisterEvictsOldEntry(t *testing.T) {
	reg := NewStreamRegistry()
	oldStream := &mockBidiStream{}
	newStream := &mockBidiStream{}

	reg.Register("runner-1", oldStream)

	// Start a SendCommand on the old stream that will be waiting for a response.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req := &runnerv1.RunnerCommandRequest{
		RequestId: "old-req",
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	}

	errCh := make(chan error, 1)
	go func() {
		_, err := reg.SendCommand(ctx, "runner-1", req)
		errCh <- err
	}()

	// Give the goroutine time to register the pending request.
	time.Sleep(50 * time.Millisecond)

	// Re-register with a new stream — this evicts the old entry.
	reg.Register("runner-1", newStream)

	// The old pending request should receive nil (channel closed by drainPending),
	// causing SendCommand to return UNAVAILABLE.
	err := <-errCh
	if err == nil {
		t.Fatal("expected error from evicted pending request")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.Unavailable {
		t.Errorf("expected UNAVAILABLE, got %v", st.Code())
	}
}

func TestStreamRegistry_SendCommandAndDeliverResponse(t *testing.T) {
	reg := NewStreamRegistry()
	var sentMsg *runnerv1.RunnerStreamServerMessage

	stream := &mockBidiStream{
		sendFn: func(msg *runnerv1.RunnerStreamServerMessage) error {
			sentMsg = msg
			return nil
		},
	}
	reg.Register("runner-1", stream)

	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-1",
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/home"},
		},
	}

	expectedResp := &runnerv1.RunnerCommandResponse{
		RequestId: "req-1",
		Result: &runnerv1.RunnerCommandResponse_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryResponse{
				ResolvedPath: "/home",
			},
		},
	}

	// Simulate the runner delivering a response asynchronously.
	go func() {
		time.Sleep(50 * time.Millisecond)
		reg.DeliverResponse("runner-1", expectedResp)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := reg.SendCommand(ctx, "runner-1", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.GetRequestId() != "req-1" {
		t.Errorf("expected request_id 'req-1', got %q", resp.GetRequestId())
	}
	if resp.GetListDirectory().GetResolvedPath() != "/home" {
		t.Errorf("expected resolved_path '/home', got %q", resp.GetListDirectory().GetResolvedPath())
	}

	if sentMsg == nil {
		t.Fatal("expected stream.Send to be called")
	}
	if sentMsg.GetCommandRequest().GetRequestId() != "req-1" {
		t.Errorf("expected sent request_id 'req-1', got %q", sentMsg.GetCommandRequest().GetRequestId())
	}
}

func TestStreamRegistry_SendCommandToUnconnectedRunner(t *testing.T) {
	reg := NewStreamRegistry()

	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-1",
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	}

	_, err := reg.SendCommand(context.Background(), "unknown-runner", req)
	if err == nil {
		t.Fatal("expected error for unconnected runner")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.Unavailable {
		t.Errorf("expected UNAVAILABLE, got %v", st.Code())
	}
}

func TestStreamRegistry_SendCommandTimeout(t *testing.T) {
	reg := NewStreamRegistry()
	stream := &mockBidiStream{}
	reg.Register("runner-1", stream)

	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-timeout",
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := reg.SendCommand(ctx, "runner-1", req)
	if err == nil {
		t.Fatal("expected timeout error")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.Unavailable {
		t.Errorf("expected UNAVAILABLE, got %v", st.Code())
	}
}

func TestStreamRegistry_DeliverResponseUnknownRunner(t *testing.T) {
	reg := NewStreamRegistry()

	// Should not panic when delivering to an unknown runner.
	reg.DeliverResponse("unknown", &runnerv1.RunnerCommandResponse{
		RequestId: "req-1",
	})
}

func TestStreamRegistry_DeliverResponseNoPendingRequest(t *testing.T) {
	reg := NewStreamRegistry()
	reg.Register("runner-1", &mockBidiStream{})

	// Should not panic when delivering a response with no matching pending request.
	reg.DeliverResponse("runner-1", &runnerv1.RunnerCommandResponse{
		RequestId: "orphan-req",
	})
}

func TestStreamRegistry_SendCommandAutoGeneratesRequestID(t *testing.T) {
	reg := NewStreamRegistry()
	stream := &mockBidiStream{}
	reg.Register("runner-1", stream)

	req := &runnerv1.RunnerCommandRequest{
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{Path: "/tmp"},
		},
	}

	// Deliver a response after a brief delay using the auto-generated ID.
	go func() {
		time.Sleep(50 * time.Millisecond)
		// Read the request_id that was auto-filled.
		entry, _ := reg.getEntry("runner-1")
		entry.pendingMu.Lock()
		for id := range entry.pending {
			entry.pendingMu.Unlock()
			reg.DeliverResponse("runner-1", &runnerv1.RunnerCommandResponse{
				RequestId: id,
				Result: &runnerv1.RunnerCommandResponse_ListDirectory{
					ListDirectory: &runnerv1.ListDirectoryResponse{ResolvedPath: "/tmp"},
				},
			})
			return
		}
		entry.pendingMu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := reg.SendCommand(ctx, "runner-1", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if req.GetRequestId() == "" {
		t.Error("expected request_id to be auto-generated")
	}

	if resp.GetRequestId() != req.GetRequestId() {
		t.Errorf("expected response request_id %q, got %q", req.GetRequestId(), resp.GetRequestId())
	}
}

func TestStreamRegistry_UpdateHeartbeatTime(t *testing.T) {
	reg := NewStreamRegistry()
	reg.Register("runner-1", &mockBidiStream{})

	entry, ok := reg.getEntry("runner-1")
	if !ok {
		t.Fatal("expected entry to exist")
	}
	initialTime := entry.lastHeartbeatAt

	time.Sleep(10 * time.Millisecond)
	reg.UpdateHeartbeatTime("runner-1")

	entry, _ = reg.getEntry("runner-1")
	if !entry.lastHeartbeatAt.After(initialTime) {
		t.Error("expected lastHeartbeatAt to be updated")
	}
}

func TestStreamRegistry_UpdateHeartbeatTimeUnknownRunner(t *testing.T) {
	reg := NewStreamRegistry()

	// Should not panic for unknown runner.
	reg.UpdateHeartbeatTime("unknown")
}

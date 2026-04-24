package daemon

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
)

func TestDispatchCommand_Stop_ReturnsAckAndSignalsStop(t *testing.T) {
	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-1",
		Command: &runnerv1.RunnerCommandRequest_Stop{
			Stop: &runnerv1.StopRunnerRequest{
				Reason: "user requested",
			},
		},
	}

	result := dispatchCommand("runner-1", req)

	if !result.stopRequested {
		t.Error("expected stopRequested to be true for stop command")
	}

	if result.response.GetRequestId() != "req-1" {
		t.Errorf("expected request_id 'req-1', got %q", result.response.GetRequestId())
	}

	stopResp := result.response.GetStop()
	if stopResp == nil {
		t.Fatal("expected StopRunnerResponse result, got nil")
	}
}

func TestDispatchCommand_ListDirectory_DoesNotSignalStop(t *testing.T) {
	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-2",
		Command: &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: &runnerv1.ListDirectoryRequest{
				Path: t.TempDir(),
			},
		},
	}

	result := dispatchCommand("runner-1", req)

	if result.stopRequested {
		t.Error("expected stopRequested to be false for ListDirectory")
	}

	if result.response.GetListDirectory() == nil {
		t.Error("expected ListDirectoryResponse result")
	}
}

func TestDispatchCommand_UnknownCommand_DoesNotSignalStop(t *testing.T) {
	req := &runnerv1.RunnerCommandRequest{
		RequestId: "req-3",
	}

	result := dispatchCommand("runner-1", req)

	if result.stopRequested {
		t.Error("expected stopRequested to be false for unknown command")
	}

	if result.response.GetError() == nil {
		t.Error("expected error result for unknown command")
	}
}

func TestRecvLoop_StopCommand_SendsAckThenReturnsStopError(t *testing.T) {
	stopReq := &runnerv1.RunnerStreamServerMessage{
		Message: &runnerv1.RunnerStreamServerMessage_CommandRequest{
			CommandRequest: &runnerv1.RunnerCommandRequest{
				RequestId: "stop-req-1",
				Command: &runnerv1.RunnerCommandRequest_Stop{
					Stop: &runnerv1.StopRunnerRequest{
						Reason: "test",
					},
				},
			},
		},
	}

	// Track whether the ack response was sent before the error was returned.
	var sentResponse *runnerv1.RunnerStreamClientMessage

	stream := &fakeStream{
		recvMessages: []*runnerv1.RunnerStreamServerMessage{stopReq},
		onSend: func(msg *runnerv1.RunnerStreamClientMessage) error {
			sentResponse = msg
			return nil
		},
	}

	client := &RunnerStreamClient{runnerID: "runner-1"}
	var sendMu sync.Mutex

	err := client.recvLoop(context.Background(), &sendMu, stream)

	if !errors.Is(err, ErrServerRequestedStop) {
		t.Fatalf("expected ErrServerRequestedStop, got %v", err)
	}

	if sentResponse == nil {
		t.Fatal("expected ack response to be sent before returning")
	}

	cmdResp := sentResponse.GetCommandResponse()
	if cmdResp == nil {
		t.Fatal("expected command_response message")
	}
	if cmdResp.GetRequestId() != "stop-req-1" {
		t.Errorf("expected request_id 'stop-req-1', got %q", cmdResp.GetRequestId())
	}
	if cmdResp.GetStop() == nil {
		t.Error("expected StopRunnerResponse in command_response")
	}
}

func TestStreamLoop_StopError_SendsGracefulStop(t *testing.T) {
	stopReq := &runnerv1.RunnerStreamServerMessage{
		Message: &runnerv1.RunnerStreamServerMessage_CommandRequest{
			CommandRequest: &runnerv1.RunnerCommandRequest{
				RequestId: "stop-req-2",
				Command: &runnerv1.RunnerCommandRequest_Stop{
					Stop: &runnerv1.StopRunnerRequest{Reason: "test"},
				},
			},
		},
	}

	var sentMessages []*runnerv1.RunnerStreamClientMessage
	var closeSendCalled bool

	stream := &fakeStream{
		recvMessages: []*runnerv1.RunnerStreamServerMessage{stopReq},
		onSend: func(msg *runnerv1.RunnerStreamClientMessage) error {
			sentMessages = append(sentMessages, msg)
			return nil
		},
		onCloseSend: func() error {
			closeSendCalled = true
			return nil
		},
	}

	client := &RunnerStreamClient{
		runnerID:          "runner-1",
		heartbeatInterval: 30 * time.Second,
		connectionInfo:    &runnerv1.RunnerConnectionInfo{},
	}

	parentCtx := context.Background()
	streamCtx, streamCancel := context.WithCancel(parentCtx)
	defer streamCancel()

	err := client.streamLoop(parentCtx, streamCtx, streamCancel, stream)

	if !errors.Is(err, ErrServerRequestedStop) {
		t.Fatalf("expected ErrServerRequestedStop, got %v", err)
	}

	// Expect: initial READY heartbeat, stop ack response, STOPPED heartbeat.
	if len(sentMessages) < 3 {
		t.Fatalf("expected at least 3 sent messages, got %d", len(sentMessages))
	}

	// First message: READY heartbeat (stream authentication).
	firstHB := sentMessages[0].GetHeartbeat()
	if firstHB == nil || firstHB.GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_READY {
		t.Errorf("expected first message to be READY heartbeat")
	}

	// Second message: stop ack response.
	ackResp := sentMessages[1].GetCommandResponse()
	if ackResp == nil || ackResp.GetStop() == nil {
		t.Errorf("expected second message to be stop ack response")
	}

	// Third message: STOPPED heartbeat (graceful shutdown).
	lastHB := sentMessages[2].GetHeartbeat()
	if lastHB == nil || lastHB.GetPhase() != runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED {
		t.Errorf("expected third message to be STOPPED heartbeat")
	}

	if !closeSendCalled {
		t.Error("expected CloseSend to be called during graceful shutdown")
	}
}

// fakeStream is a test double for CommandStream.
type fakeStream struct {
	recvMessages []*runnerv1.RunnerStreamServerMessage
	recvIdx      int
	onSend       func(*runnerv1.RunnerStreamClientMessage) error
	onCloseSend  func() error
}

func (f *fakeStream) Recv() (*runnerv1.RunnerStreamServerMessage, error) {
	if f.recvIdx >= len(f.recvMessages) {
		select {} // block forever after messages are exhausted
	}
	msg := f.recvMessages[f.recvIdx]
	f.recvIdx++
	return msg, nil
}

func (f *fakeStream) Send(msg *runnerv1.RunnerStreamClientMessage) error {
	if f.onSend != nil {
		return f.onSend(msg)
	}
	return nil
}

func (f *fakeStream) CloseSend() error {
	if f.onCloseSend != nil {
		return f.onCloseSend()
	}
	return nil
}

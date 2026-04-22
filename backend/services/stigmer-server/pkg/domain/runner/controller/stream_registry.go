package runner

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/grpc"
)

// StreamRegistry tracks active bidi streams between runners and the server.
//
// Each runner has at most one active stream. The registry provides:
//   - Registration/deregistration of runner streams (connect/disconnect lifecycle)
//   - Command routing: send a command to a runner and block until the response
//   - Response delivery: route a runner's command response to the waiting caller
//
// Thread-safety: the registry uses a read-heavy RWMutex for the streams map,
// and per-entry mutexes for stream.Send serialization and pending request management.
type StreamRegistry struct {
	mu      sync.RWMutex
	streams map[string]*streamEntry
}

// streamEntry represents an active bidi stream for a single runner.
type streamEntry struct {
	stream          grpc.BidiStreamingServer[runnerv1.RunnerStreamClientMessage, runnerv1.RunnerStreamServerMessage]
	connectedAt     time.Time
	lastHeartbeatAt time.Time

	// sendMu serializes stream.Send calls. grpc-go allows concurrent
	// Send + Recv, but concurrent Sends are unsafe.
	sendMu sync.Mutex

	// pending tracks in-flight command requests awaiting responses.
	// Key: request_id, Value: channel that receives the response.
	pendingMu sync.Mutex
	pending   map[string]chan *runnerv1.RunnerCommandResponse
}

// NewStreamRegistry creates an empty stream registry.
func NewStreamRegistry() *StreamRegistry {
	return &StreamRegistry{
		streams: make(map[string]*streamEntry),
	}
}

// Register adds or replaces the stream entry for a runner.
//
// If the runner already has an active stream (e.g., fast restart before the old
// stream's recv loop detected the disconnect), the old entry is evicted: all
// pending command requests receive nil (causing callers to time out or fail),
// and the old stream's recv loop will exit on its own when the transport closes.
func (r *StreamRegistry) Register(
	runnerID string,
	stream grpc.BidiStreamingServer[runnerv1.RunnerStreamClientMessage, runnerv1.RunnerStreamServerMessage],
) {
	now := time.Now()

	r.mu.Lock()
	defer r.mu.Unlock()

	if old, exists := r.streams[runnerID]; exists {
		log.Warn().
			Str("runner_id", runnerID).
			Time("old_connected_at", old.connectedAt).
			Msg("Evicting stale stream entry for runner (new stream replacing old)")
		drainPending(old)
	}

	r.streams[runnerID] = &streamEntry{
		stream:          stream,
		connectedAt:     now,
		lastHeartbeatAt: now,
		pending:         make(map[string]chan *runnerv1.RunnerCommandResponse),
	}

	log.Debug().
		Str("runner_id", runnerID).
		Msg("Stream registered")
}

// Unregister removes the stream entry for a runner and drains pending requests.
//
// Safe to call multiple times for the same runner — subsequent calls are no-ops.
func (r *StreamRegistry) Unregister(runnerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, exists := r.streams[runnerID]
	if !exists {
		return
	}

	drainPending(entry)
	delete(r.streams, runnerID)

	log.Debug().
		Str("runner_id", runnerID).
		Msg("Stream unregistered")
}

// SendCommand sends a command to the runner's stream and blocks until the
// response arrives or the context expires.
//
// Returns UNAVAILABLE if the runner has no active stream.
func (r *StreamRegistry) SendCommand(
	ctx context.Context,
	runnerID string,
	req *runnerv1.RunnerCommandRequest,
) (*runnerv1.RunnerCommandResponse, error) {
	entry, ok := r.getEntry(runnerID)
	if !ok {
		return nil, grpclib.UnavailableError("runner %q is not connected", runnerID)
	}

	if req.GetRequestId() == "" {
		req.RequestId = uuid.NewString()
	}

	respCh := make(chan *runnerv1.RunnerCommandResponse, 1)

	entry.pendingMu.Lock()
	entry.pending[req.GetRequestId()] = respCh
	entry.pendingMu.Unlock()

	defer func() {
		entry.pendingMu.Lock()
		delete(entry.pending, req.GetRequestId())
		entry.pendingMu.Unlock()
	}()

	serverMsg := &runnerv1.RunnerStreamServerMessage{
		Message: &runnerv1.RunnerStreamServerMessage_CommandRequest{
			CommandRequest: req,
		},
	}

	entry.sendMu.Lock()
	err := entry.stream.Send(serverMsg)
	entry.sendMu.Unlock()

	if err != nil {
		return nil, grpclib.UnavailableError("failed to send command to runner %q: %v", runnerID, err)
	}

	log.Debug().
		Str("runner_id", runnerID).
		Str("request_id", req.GetRequestId()).
		Msg("Command sent to runner, awaiting response")

	select {
	case resp := <-respCh:
		if resp == nil {
			return nil, grpclib.UnavailableError("runner %q stream closed while awaiting response", runnerID)
		}
		return resp, nil
	case <-ctx.Done():
		return nil, grpclib.UnavailableError("command to runner %q timed out: %v", runnerID, ctx.Err())
	}
}

// DeliverResponse routes a command response from the runner's recv loop to the
// caller waiting in SendCommand. If no caller is waiting (request_id not found
// or already timed out), the response is logged and dropped.
func (r *StreamRegistry) DeliverResponse(runnerID string, resp *runnerv1.RunnerCommandResponse) {
	entry, ok := r.getEntry(runnerID)
	if !ok {
		log.Warn().
			Str("runner_id", runnerID).
			Str("request_id", resp.GetRequestId()).
			Msg("Received command response for unknown runner stream")
		return
	}

	entry.pendingMu.Lock()
	ch, exists := entry.pending[resp.GetRequestId()]
	entry.pendingMu.Unlock()

	if !exists {
		log.Warn().
			Str("runner_id", runnerID).
			Str("request_id", resp.GetRequestId()).
			Msg("Received command response with no pending request (timed out or duplicate)")
		return
	}

	select {
	case ch <- resp:
		log.Debug().
			Str("runner_id", runnerID).
			Str("request_id", resp.GetRequestId()).
			Msg("Command response delivered")
	default:
		log.Warn().
			Str("runner_id", runnerID).
			Str("request_id", resp.GetRequestId()).
			Msg("Command response channel full, dropping")
	}
}

// UpdateHeartbeatTime records when the last heartbeat was received for a runner.
func (r *StreamRegistry) UpdateHeartbeatTime(runnerID string) {
	entry, ok := r.getEntry(runnerID)
	if !ok {
		return
	}

	entry.pendingMu.Lock()
	entry.lastHeartbeatAt = time.Now()
	entry.pendingMu.Unlock()
}

// IsConnected returns true if the runner has an active stream registered.
func (r *StreamRegistry) IsConnected(runnerID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, exists := r.streams[runnerID]
	return exists
}

// getEntry retrieves a stream entry under a read lock.
func (r *StreamRegistry) getEntry(runnerID string) (*streamEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.streams[runnerID]
	return entry, ok
}

// drainPending closes all pending response channels with nil, unblocking
// any callers waiting in SendCommand. Must be called while holding r.mu.
func drainPending(entry *streamEntry) {
	entry.pendingMu.Lock()
	defer entry.pendingMu.Unlock()

	for id, ch := range entry.pending {
		close(ch)
		delete(entry.pending, id)
	}
}

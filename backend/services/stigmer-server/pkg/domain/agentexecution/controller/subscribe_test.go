package agentexecution

import (
	"context"
	"sync"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

// getHookStore wraps a real store and fires a one-shot hook at the START of the
// first GetResource call — before delegating. It is the seam that injects a
// broadcast "in the gap": the moment the Subscribe handler reads the snapshot is
// exactly the window the register-before-snapshot fix must cover.
type getHookStore struct {
	store.Store
	once  sync.Once
	onGet func()
}

func (h *getHookStore) GetResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	id string,
	msg proto.Message,
) error {
	if h.onGet != nil {
		h.once.Do(h.onGet)
	}
	return h.Store.GetResource(ctx, kind, id, msg)
}

// mockSubscribeServer captures everything the controller sends and exposes a
// cancelable context, implementing AgentExecutionQueryController_SubscribeServer.
type mockSubscribeServer struct {
	ctx   context.Context
	mu    sync.Mutex
	sends []*agentexecutionv1.AgentExecution
}

func (m *mockSubscribeServer) Send(e *agentexecutionv1.AgentExecution) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sends = append(m.sends, e)
	return nil
}
func (m *mockSubscribeServer) Context() context.Context     { return m.ctx }
func (m *mockSubscribeServer) SetHeader(metadata.MD) error  { return nil }
func (m *mockSubscribeServer) SendHeader(metadata.MD) error { return nil }
func (m *mockSubscribeServer) SetTrailer(metadata.MD)       {}
func (m *mockSubscribeServer) SendMsg(interface{}) error    { return nil }
func (m *mockSubscribeServer) RecvMsg(interface{}) error    { return nil }

func (m *mockSubscribeServer) snapshots() []*agentexecutionv1.AgentExecution {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*agentexecutionv1.AgentExecution, len(m.sends))
	copy(out, m.sends)
	return out
}

func execWithPhase(id string, phase agentexecutionv1.ExecutionPhase, messages int) *agentexecutionv1.AgentExecution {
	msgs := make([]*agentexecutionv1.AgentMessage, messages)
	for i := range msgs {
		msgs[i] = &agentexecutionv1.AgentMessage{Content: "m"}
	}
	return &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id},
		Spec:       &agentexecutionv1.AgentExecutionSpec{},
		Status:     &agentexecutionv1.AgentExecutionStatus{Phase: phase, Messages: msgs},
	}
}

// runSubscribe runs the controller's Subscribe to completion (the seeded states
// drive it to a terminal phase) and returns the frames the client received.
// A timeout guards the negative case: if a regression reintroduces the gap, the
// post-gap terminal frame is dropped, the loop blocks, and the watchdog cancels
// so the test fails fast instead of hanging.
func runSubscribe(
	t *testing.T,
	controller *AgentExecutionController,
	id string,
) []*agentexecutionv1.AgentExecution {
	t.Helper()
	ctx, cancel := context.WithCancel(contextWithAgentExecutionKind())
	defer cancel()
	srv := &mockSubscribeServer{ctx: ctx}

	done := make(chan error, 1)
	go func() {
		done <- controller.Subscribe(&agentexecutionv1.AgentExecutionId{Value: id}, srv)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Subscribe returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		cancel()
		<-done
		t.Fatal("Subscribe did not reach a terminal phase in time — the post-gap broadcast was likely dropped (register-before-snapshot regression)")
	}
	return srv.snapshots()
}

// TestSubscribe_DeliversUpdateBroadcastDuringSnapshotRead is the deterministic
// reproduction of the replay gap. A broadcast fired exactly while the snapshot is
// read must still reach the subscriber. Register-before-snapshot guarantees it;
// the old load-then-subscribe order dropped it (no subscriber yet), which the
// watchdog in runSubscribe would catch as a hang.
func TestSubscribe_DeliversUpdateBroadcastDuringSnapshotRead(t *testing.T) {
	raw, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	hs := &getHookStore{Store: raw}
	defer hs.Close()

	controller := NewAgentExecutionController(hs, nil, nil, nil)

	const id = "exec-gap"
	older := execWithPhase(id, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 1)
	newer := execWithPhase(id, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2)

	if err := raw.SaveResource(contextWithAgentExecutionKind(),
		apiresourcekind.ApiResourceKind_agent_execution, id, older); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	// Fire the post-gap broadcast at the instant the snapshot is read.
	hs.onGet = func() { controller.GetStreamBroker().Broadcast(newer) }

	got := runSubscribe(t, controller, id)

	if len(got) != 2 {
		t.Fatalf("expected 2 frames [snapshot, post-gap update], got %d", len(got))
	}
	if got[0].GetStatus().GetPhase() != agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
		t.Errorf("first frame should be the snapshot (IN_PROGRESS), got %s", got[0].GetStatus().GetPhase())
	}
	if got[1].GetStatus().GetPhase() != agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
		t.Errorf("second frame should be the post-gap update (COMPLETED), got %s", got[1].GetStatus().GetPhase())
	}
}

// TestSubscribe_SuppressesOverlapDuplicate verifies the de-dup guard: a broadcast
// equal to the snapshot (the at-or-before-snapshot overlap that register-first
// intentionally trades for gap-closure) is NOT re-delivered. A distinct terminal
// frame following it still is.
func TestSubscribe_SuppressesOverlapDuplicate(t *testing.T) {
	raw, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	hs := &getHookStore{Store: raw}
	defer hs.Close()

	controller := NewAgentExecutionController(hs, nil, nil, nil)

	const id = "exec-dup"
	snapshot := execWithPhase(id, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 1)
	overlap := proto.Clone(snapshot).(*agentexecutionv1.AgentExecution) // equal to snapshot
	terminal := execWithPhase(id, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2)

	if err := raw.SaveResource(contextWithAgentExecutionKind(),
		apiresourcekind.ApiResourceKind_agent_execution, id, snapshot); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	// First the overlap duplicate (must be suppressed), then a distinct terminal.
	hs.onGet = func() {
		b := controller.GetStreamBroker()
		b.Broadcast(overlap)
		b.Broadcast(terminal)
	}

	got := runSubscribe(t, controller, id)

	if len(got) != 2 {
		t.Fatalf("expected 2 frames [snapshot, terminal] with the overlap duplicate suppressed, got %d", len(got))
	}
	if !proto.Equal(got[0], snapshot) {
		t.Errorf("first frame should be the snapshot")
	}
	if got[1].GetStatus().GetPhase() != agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
		t.Errorf("second frame should be the terminal update, got %s", got[1].GetStatus().GetPhase())
	}
}

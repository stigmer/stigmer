package agentexecution

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/proto"
)

// countingStore wraps a store.Store and counts the two write primitives so a test
// can assert which one a path used. The append-only fix requires the UpdateStatus
// paths to persist via the atomic UpdateResource, never the whole-resource
// SaveResource that could clobber a concurrent approval append.
type countingStore struct {
	store.Store
	updateResource atomic.Int64
	saveResource   atomic.Int64
}

func (c *countingStore) UpdateResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	id string,
	msg proto.Message,
	modify func() error,
) error {
	c.updateResource.Add(1)
	return c.Store.UpdateResource(ctx, kind, id, msg, modify)
}

func (c *countingStore) SaveResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	id string,
	msg proto.Message,
) error {
	c.saveResource.Add(1)
	return c.Store.SaveResource(ctx, kind, id, msg)
}

// setupCountingController builds a controller backed by a counting store so tests
// can both exercise the real pipeline and assert the persistence primitive used.
func setupCountingController(t *testing.T) (*AgentExecutionController, *countingStore) {
	t.Helper()
	raw, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	cs := &countingStore{Store: raw}
	return NewAgentExecutionController(cs, nil, nil, nil), cs
}

// gatedExecution builds an execution parked at the approval gate with a single
// gated tool call, ready to be seeded directly into the store.
func gatedExecution(id, toolCallID string) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id},
		Spec:       &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			Messages: []*agentexecutionv1.AgentMessage{
				{ToolCalls: []*agentexecutionv1.ToolCall{{
					Id:               toolCallID,
					Name:             "Write",
					Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
					RequiresApproval: true,
				}}},
			},
		},
	}
}

// gatedHeartbeatStatus is the status an agent-runner heartbeat would resend while
// the call is still gated: the same single gated message, with the server-owned
// approval fields left UNSPECIFIED (the runner never knows the decision).
func gatedHeartbeatStatus(toolCallID string) *agentexecutionv1.AgentExecutionStatus {
	return &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		Messages: []*agentexecutionv1.AgentMessage{
			{ToolCalls: []*agentexecutionv1.ToolCall{{
				Id:               toolCallID,
				Name:             "Write",
				Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
				RequiresApproval: true,
			}}},
		},
	}
}

// The UpdateStatus path must persist via the atomic store.UpdateResource, never
// the whole-resource SaveResource the append-only fix replaced. A SaveResource on
// this path is the regression that lets a concurrent SubmitApproval append be lost.
func TestUpdateStatus_PersistsViaUpdateResource(t *testing.T) {
	controller, cs := setupCountingController(t)
	defer cs.Close()

	ctx := contextWithAgentExecutionKind()
	id := "exec-usage"

	// Seed through the embedded store so the seed write is not counted.
	if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
		gatedExecution(id, "tc-1")); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	_, err := controller.UpdateStatus(ctx, &agentexecutionv1.AgentExecutionUpdateStatusInput{
		ExecutionId: id,
		Status:      gatedHeartbeatStatus("tc-1"),
	})
	if err != nil {
		t.Fatalf("UpdateStatus failed: %v", err)
	}

	if got := cs.updateResource.Load(); got != 1 {
		t.Errorf("expected exactly 1 atomic UpdateResource on the UpdateStatus path, got %d", got)
	}
	if got := cs.saveResource.Load(); got != 0 {
		t.Errorf("expected 0 whole-resource SaveResource on the UpdateStatus path, got %d", got)
	}
}

// Regression for the append-only invariant: a runner heartbeat (UpdateStatus) and
// a user's approval (SubmitApproval) race on the same gated execution — the exact
// designed overlap window. Because both now persist via the atomic, lock-serialized
// store.UpdateResource, the decision can never be lost to a stale-read overwrite,
// and re-authoring REQUESTED on every heartbeat never duplicates the request. Under
// the old whole-resource SaveResource on the UpdateStatus path, the heartbeat would
// intermittently clobber the just-recorded decision.
func TestUpdateStatus_ConcurrentWithSubmitApproval_KeepsDecision(t *testing.T) {
	controller, cs := setupCountingController(t)
	defer cs.Close()

	ctx := contextWithAgentExecutionKind()
	const toolCallID = "tc-1"
	const iterations = 50

	for i := 0; i < iterations; i++ {
		id := fmt.Sprintf("exec-race-%d", i)
		if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
			gatedExecution(id, toolCallID)); err != nil {
			t.Fatalf("iteration %d: seed failed: %v", i, err)
		}

		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)

		// Heartbeat: re-sends the gated transcript, re-authors REQUESTED, re-projects.
		go func() {
			defer wg.Done()
			<-start
			if _, err := controller.UpdateStatus(ctx, &agentexecutionv1.AgentExecutionUpdateStatusInput{
				ExecutionId: id,
				Status:      gatedHeartbeatStatus(toolCallID),
			}); err != nil {
				t.Errorf("iteration %d: UpdateStatus failed: %v", i, err)
			}
		}()

		// Approval: records the decision and appends the DECISION event.
		go func() {
			defer wg.Done()
			<-start
			if _, err := controller.SubmitApproval(ctx, &agentexecutionv1.SubmitApprovalInput{
				AgentExecutionId: id,
				ToolCallId:       toolCallID,
				Action:           agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			}); err != nil {
				t.Errorf("iteration %d: SubmitApproval failed: %v", i, err)
			}
		}()

		close(start)
		wg.Wait()

		final := &agentexecutionv1.AgentExecution{}
		if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
			t.Fatalf("iteration %d: reload failed: %v", i, err)
		}

		// The decision must survive on the tool call itself...
		tc := findToolCallInExecution(final, toolCallID)
		if tc == nil {
			t.Fatalf("iteration %d: tool call %s vanished from the transcript", i, toolCallID)
		}
		if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
			t.Fatalf("iteration %d: approval decision lost — approval_action=%s", i, tc.GetApprovalAction())
		}

		// ...and on the append-only stream: exactly one REQUESTED (no duplicate from
		// the heartbeat re-authoring) and the surviving APPROVED decision.
		var requested, approved int
		for _, ev := range final.GetStatus().GetApprovalEventStream().GetEvents() {
			if ev.GetApprovalRequestId() != toolCallID {
				continue
			}
			switch ev.GetEventType() {
			case agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED:
				requested++
			case agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED:
				approved++
			}
		}
		if requested != 1 {
			t.Fatalf("iteration %d: expected exactly 1 REQUESTED event, got %d", i, requested)
		}
		if approved != 1 {
			t.Fatalf("iteration %d: expected the APPROVED decision to survive on the stream, got %d", i, approved)
		}
	}
}

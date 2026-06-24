package activities

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	"go.temporal.io/sdk/testsuite"
	"google.golang.org/protobuf/proto"
)

// countingStore wraps a store.Store and counts the two write primitives, so a test
// can assert the activity persists via the atomic UpdateResource rather than the
// whole-resource SaveResource the append-only fix replaced.
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

type noopBroker struct{}

func (noopBroker) Broadcast(*agentexecutionv1.AgentExecution) {}

func newTestStore(t *testing.T) *countingStore {
	t.Helper()
	raw, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	return &countingStore{Store: raw}
}

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

func findToolCall(execution *agentexecutionv1.AgentExecution, toolCallID string) *agentexecutionv1.ToolCall {
	for _, msg := range execution.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() == toolCallID {
				return tc
			}
		}
	}
	for _, sa := range execution.GetStatus().GetSubAgentExecutions() {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if tc.GetId() == toolCallID {
					return tc
				}
			}
		}
	}
	return nil
}

// appendApprovalDecision performs the same atomic store mutation SubmitApproval's
// recordApprovalDecisionStep performs (author REQUESTED, record the decision on
// the tool call, append the DECISION event, reproject) — used to drive the
// concurrent approver in the activity race test without importing the controller.
func appendApprovalDecision(t *testing.T, st store.Store, ctx context.Context, executionID, toolCallID string) {
	t.Helper()
	updated := &agentexecutionv1.AgentExecution{}
	err := st.UpdateResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, updated, func() error {
		if updated.Status == nil {
			updated.Status = &agentexecutionv1.AgentExecutionStatus{}
		}
		approval.EnsureApprovalRequests(updated.Status, executionID)
		tc := findToolCall(updated, toolCallID)
		if tc == nil {
			return fmt.Errorf("tool call %s not found", toolCallID)
		}
		if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
			return nil // already decided (a concurrent writer won the race)
		}
		tc.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
		tc.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)
		approval.RecordDecisionEvent(updated.Status, tc, "", "")
		updated.Status.PendingApprovals = approval.ProjectPendingApprovals(
			updated.Status.GetPhase(),
			updated.Status.GetMessages(),
			updated.Status.GetSubAgentExecutions(),
			updated.Status.GetApprovalEventStream(),
		)
		return nil
	})
	if err != nil {
		t.Errorf("approval append failed: %v", err)
	}
}

func runActivity(t *testing.T, impl *UpdateExecutionStatusActivityImpl, executionID string, status *agentexecutionv1.AgentExecutionStatus) error {
	t.Helper()
	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	env.RegisterActivity(impl.UpdateExecutionStatus)
	_, err := env.ExecuteActivity(impl.UpdateExecutionStatus, executionID, status)
	return err
}

// The activity must persist via the atomic store.UpdateResource, never the
// whole-resource SaveResource the append-only fix replaced.
func TestActivity_PersistsViaUpdateResource(t *testing.T) {
	cs := newTestStore(t)
	defer cs.Close()
	impl := NewUpdateExecutionStatusActivityImpl(cs, noopBroker{})

	ctx := context.Background()
	id := "exec-activity-usage"
	if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
		gatedExecution(id, "tc-1")); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	if err := runActivity(t, impl, id, gatedHeartbeatStatus("tc-1")); err != nil {
		t.Fatalf("activity failed: %v", err)
	}

	if got := cs.updateResource.Load(); got != 1 {
		t.Errorf("expected exactly 1 atomic UpdateResource on the activity path, got %d", got)
	}
	if got := cs.saveResource.Load(); got != 0 {
		t.Errorf("expected 0 whole-resource SaveResource on the activity path, got %d", got)
	}
}

// A decision already appended to the stream (by a SubmitApproval that ran first)
// must survive a subsequent activity heartbeat that does not carry it, and the
// heartbeat must not duplicate the REQUESTED event.
func TestActivity_PreservesExistingDecision(t *testing.T) {
	cs := newTestStore(t)
	defer cs.Close()
	impl := NewUpdateExecutionStatusActivityImpl(cs, noopBroker{})

	ctx := context.Background()
	id := "exec-activity-preserve"
	const toolCallID = "tc-1"
	if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
		gatedExecution(id, toolCallID)); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	// A prior approval records the decision + appends the DECISION event.
	appendApprovalDecision(t, cs, ctx, id, toolCallID)

	// Two heartbeats that never carry the decision (Python's view stays UNSPECIFIED).
	for n := 0; n < 2; n++ {
		if err := runActivity(t, impl, id, gatedHeartbeatStatus(toolCallID)); err != nil {
			t.Fatalf("activity heartbeat %d failed: %v", n, err)
		}
	}

	final := &agentexecutionv1.AgentExecution{}
	if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
		t.Fatalf("reload failed: %v", err)
	}

	tc := findToolCall(final, toolCallID)
	if tc == nil || tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Fatalf("decision not preserved across heartbeats: approval_action=%v", tc.GetApprovalAction())
	}

	requested, approved := countStreamEvents(final, toolCallID)
	if requested != 1 {
		t.Fatalf("expected exactly 1 REQUESTED event after repeated heartbeats, got %d", requested)
	}
	if approved != 1 {
		t.Fatalf("expected the APPROVED decision preserved, got %d", approved)
	}
}

// The activity heartbeat and a concurrent approval append race on the same gated
// execution. Because both persist via the atomic, lock-serialized UpdateResource,
// the decision can never be clobbered and the REQUESTED is never duplicated.
func TestActivity_ConcurrentWithApproval_KeepsDecision(t *testing.T) {
	cs := newTestStore(t)
	defer cs.Close()
	impl := NewUpdateExecutionStatusActivityImpl(cs, noopBroker{})

	ctx := context.Background()
	const toolCallID = "tc-1"
	const iterations = 25

	for i := 0; i < iterations; i++ {
		id := fmt.Sprintf("exec-activity-race-%d", i)
		if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
			gatedExecution(id, toolCallID)); err != nil {
			t.Fatalf("iteration %d: seed failed: %v", i, err)
		}

		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)

		go func() {
			defer wg.Done()
			<-start
			if err := runActivity(t, impl, id, gatedHeartbeatStatus(toolCallID)); err != nil {
				t.Errorf("iteration %d: activity failed: %v", i, err)
			}
		}()
		go func() {
			defer wg.Done()
			<-start
			appendApprovalDecision(t, cs, ctx, id, toolCallID)
		}()

		close(start)
		wg.Wait()

		final := &agentexecutionv1.AgentExecution{}
		if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
			t.Fatalf("iteration %d: reload failed: %v", i, err)
		}

		tc := findToolCall(final, toolCallID)
		if tc == nil || tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
			t.Fatalf("iteration %d: approval decision lost — approval_action=%v", i, tc.GetApprovalAction())
		}
		requested, approved := countStreamEvents(final, toolCallID)
		if requested != 1 {
			t.Fatalf("iteration %d: expected exactly 1 REQUESTED event, got %d", i, requested)
		}
		if approved != 1 {
			t.Fatalf("iteration %d: expected the APPROVED decision to survive, got %d", i, approved)
		}
	}
}

func countStreamEvents(execution *agentexecutionv1.AgentExecution, toolCallID string) (requested, approved int) {
	for _, ev := range execution.GetStatus().GetApprovalEventStream().GetEvents() {
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
	return requested, approved
}

package agentexecution

import (
	"fmt"
	"sync"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
)

// newPausePersistStep builds the lifecycle persist step under test for a pause
// (PAUSED, no error set/clear) plus a request context carrying only the loaded
// execution id — the step re-loads the resource fresh inside its atomic
// UpdateResource closure, so the carried execution is used only for the id.
func newPausePersistStep(
	store *countingStore,
	id string,
) (*UpdateExecutionPhaseAndPersistStep[*agentexecutionv1.PauseAgentExecutionInput], *pipeline.RequestContext[*agentexecutionv1.PauseAgentExecutionInput]) {
	step := NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.PauseAgentExecutionInput](
		store, agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, false, false)
	reqCtx := pipeline.NewRequestContext(
		contextWithAgentExecutionKind(),
		&agentexecutionv1.PauseAgentExecutionInput{Id: id})
	reqCtx.Set(LoadedExecutionKey, gatedExecution(id, "tc-1"))
	return step, reqCtx
}

// The lifecycle persist must go through the atomic store.UpdateResource, never the
// whole-resource SaveResource it replaced. A SaveResource here is the regression
// that lets a concurrent SubmitApproval append be clobbered. Asserted for both a
// non-terminal (pause) and a terminal (cancel/terminate) transition, since they
// share the one step.
func TestLifecyclePersist_UsesUpdateResource(t *testing.T) {
	cases := []struct {
		name        string
		targetPhase agentexecutionv1.ExecutionPhase
		setError    bool
		clearError  bool
	}{
		{"pause", agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, false, false},
		{"cancel", agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, false, false},
		{"terminate", agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, true, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, cs := setupCountingController(t)
			defer cs.Close()

			ctx := contextWithAgentExecutionKind()
			id := "exec-lifecycle-persist-" + tc.name

			// Seed through the embedded store so the seed write is not counted.
			if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
				gatedExecution(id, "tc-1")); err != nil {
				t.Fatalf("seed failed: %v", err)
			}

			step := NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.PauseAgentExecutionInput](
				cs, tc.targetPhase, tc.setError, tc.clearError)
			reqCtx := pipeline.NewRequestContext(ctx, &agentexecutionv1.PauseAgentExecutionInput{Id: id})
			reqCtx.Set(LoadedExecutionKey, gatedExecution(id, "tc-1"))

			if err := step.Execute(reqCtx); err != nil {
				t.Fatalf("lifecycle persist failed: %v", err)
			}

			if got := cs.updateResource.Load(); got != 1 {
				t.Errorf("expected exactly 1 atomic UpdateResource on the lifecycle persist, got %d", got)
			}
			if got := cs.saveResource.Load(); got != 0 {
				t.Errorf("expected 0 whole-resource SaveResource on the lifecycle persist, got %d", got)
			}

			// The transition landed.
			final := &agentexecutionv1.AgentExecution{}
			if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
				t.Fatalf("reload failed: %v", err)
			}
			if final.GetStatus().GetPhase() != tc.targetPhase {
				t.Errorf("expected phase %s, got %s", tc.targetPhase, final.GetStatus().GetPhase())
			}
		})
	}
}

// Regression for the append-only invariant on the lifecycle path: a lifecycle op
// (pause) and an approval-decision append race on the same gated execution — the
// exact overlap window the plan describes (pause from an approval-overlap phase
// while a user approves a gated call). Because the lifecycle persist now re-reads
// fresh under the store's write lock inside store.UpdateResource, it can never
// clobber a decision a concurrent writer appended.
//
// The concurrent writer replays SubmitApproval's exact decision-append helpers
// (approval.EnsureApprovalRequests then approval.RecordDecisionEvent) at the store
// level rather than the full SubmitApproval RPC. This is deliberate: pause flips
// the phase to PAUSED, which SubmitApproval's phase precondition legitimately
// rejects, so driving the RPC would couple this append-only assertion to that
// precondition's timing. Appending through the real helpers under the same write
// lock is the faithful, deterministic way to prove the persistence invariant
// (mirroring the Session-16 activity concurrency test).
func TestLifecyclePause_ConcurrentWithDecisionAppend_KeepsDecision(t *testing.T) {
	_, cs := setupCountingController(t)
	defer cs.Close()

	ctx := contextWithAgentExecutionKind()
	const toolCallID = "tc-1"
	const iterations = 50

	for i := 0; i < iterations; i++ {
		id := fmt.Sprintf("exec-pause-race-%d", i)
		if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id,
			gatedExecution(id, toolCallID)); err != nil {
			t.Fatalf("iteration %d: seed failed: %v", i, err)
		}

		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)

		// Lifecycle pause: applies the phase transition + persists atomically.
		go func() {
			defer wg.Done()
			step, reqCtx := newPausePersistStep(cs, id)
			<-start
			if err := step.Execute(reqCtx); err != nil {
				t.Errorf("iteration %d: pause persist failed: %v", i, err)
			}
		}()

		// Approval append: seeds REQUESTED then records the APPROVED decision event,
		// exactly as SubmitApproval's RecordApprovalDecision step does, under the
		// store's write lock.
		go func() {
			defer wg.Done()
			<-start
			updated := &agentexecutionv1.AgentExecution{}
			err := cs.Store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, updated,
				func() error {
					approval.EnsureApprovalRequests(updated.Status, id)
					tc := findToolCallInExecution(updated, toolCallID)
					if tc == nil {
						return fmt.Errorf("tool call %s not found", toolCallID)
					}
					tc.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
					tc.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)
					approval.RecordDecisionEvent(updated.Status, tc, "", "")
					return nil
				})
			if err != nil {
				t.Errorf("iteration %d: decision append failed: %v", i, err)
			}
		}()

		close(start)
		wg.Wait()

		final := &agentexecutionv1.AgentExecution{}
		if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
			t.Fatalf("iteration %d: reload failed: %v", i, err)
		}

		// Regardless of interleaving, the append-only stream must retain exactly one
		// REQUESTED (no duplicate from re-seeding) and the surviving APPROVED
		// decision (never clobbered by the pause persist).
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
			t.Fatalf("iteration %d: APPROVED decision lost from the stream, got %d", i, approved)
		}

		// The pause transition must also have landed (the decision append never owns
		// the phase).
		if final.GetStatus().GetPhase() != agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED {
			t.Fatalf("iteration %d: expected PAUSED, got %s", i, final.GetStatus().GetPhase())
		}
	}
}

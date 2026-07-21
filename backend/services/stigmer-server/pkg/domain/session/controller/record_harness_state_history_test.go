package session

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func historyStepContext(t *testing.T, merged, existing *sessionv1.Session) *pipeline.RequestContext[*sessionv1.Session] {
	t.Helper()
	reqCtx := pipeline.NewRequestContext(context.Background(), merged)
	// After BuildUpdateState the context's new state is the merged resource;
	// NewRequestContext already cloned the input into new state.
	if existing != nil {
		reqCtx.Set(steps.ExistingResourceKey, existing)
	}
	return reqCtx
}

func sessionWithHarnessState(id string, history ...string) *sessionv1.Session {
	return &sessionv1.Session{
		Spec: &sessionv1.SessionSpec{
			HarnessStateId:        id,
			HarnessStateIdHistory: history,
		},
	}
}

func TestRecordHarnessStateHistory_ReplacedIdIsAppended(t *testing.T) {
	// The cursor-runner resume-failure fallback: the update replaces the
	// session's Cursor agent id with a freshly created one. The replaced id
	// must survive in the history or its ledger events become orphans.
	existing := sessionWithHarnessState("agent-old")
	merged := sessionWithHarnessState("agent-new")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Equal(t, []string{"agent-old"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory(),
		"the replaced agent id must be appended to the history")
}

func TestRecordHarnessStateHistory_UnchangedIdAppendsNothing(t *testing.T) {
	existing := sessionWithHarnessState("agent-same", "agent-ancient")
	merged := sessionWithHarnessState("agent-same")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Equal(t, []string{"agent-ancient"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory(),
		"an unchanged id must not grow the history; stored history is preserved")
}

func TestRecordHarnessStateHistory_ClientSuppliedHistoryIsDiscarded(t *testing.T) {
	// Server-owned field: a stale client resending an old spec (or a
	// malicious one injecting ids) must never influence the history.
	existing := sessionWithHarnessState("agent-current", "agent-real-old")
	merged := sessionWithHarnessState("agent-current", "agent-forged-1", "agent-forged-2")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Equal(t, []string{"agent-real-old"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory(),
		"client-supplied history must be replaced by the stored history")
}

func TestRecordHarnessStateHistory_FirstExecutionSetsIdWithoutHistory(t *testing.T) {
	// First execution: harness_state_id goes empty -> set. Nothing was
	// replaced, so the history stays empty.
	existing := sessionWithHarnessState("")
	merged := sessionWithHarnessState("agent-first")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Empty(t, reqCtx.NewState().GetSpec().GetHarnessStateIdHistory())
}

func TestRecordHarnessStateHistory_RepeatedReplacementsAccumulate(t *testing.T) {
	existing := sessionWithHarnessState("agent-2", "agent-1")
	merged := sessionWithHarnessState("agent-3")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Equal(t, []string{"agent-1", "agent-2"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory(),
		"replacements accumulate oldest-first")
}

func TestRecordHarnessStateHistory_DuplicateIdNotAppendedTwice(t *testing.T) {
	// An id already recorded (e.g. an A->B->A flap) is not duplicated.
	existing := sessionWithHarnessState("agent-a", "agent-a")
	merged := sessionWithHarnessState("agent-b")

	reqCtx := historyStepContext(t, merged, existing)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	assert.Equal(t, []string{"agent-a"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory())
}

func TestRecordHarnessStateHistory_NoExistingResourceIsNoOp(t *testing.T) {
	merged := sessionWithHarnessState("agent-new", "agent-client-junk")

	reqCtx := historyStepContext(t, merged, nil)
	require.NoError(t, NewRecordHarnessStateHistoryStep().Execute(reqCtx))

	// Without an existing resource there is no stored history to rebuild
	// from; the step leaves the state untouched (create-path safety).
	assert.Equal(t, []string{"agent-client-junk"},
		reqCtx.NewState().GetSpec().GetHarnessStateIdHistory())
}

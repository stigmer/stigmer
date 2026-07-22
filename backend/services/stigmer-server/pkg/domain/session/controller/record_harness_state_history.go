package session

import (
	"slices"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// RecordHarnessStateHistoryStep maintains the server-owned
// harness_state_id_history on the merged update state.
//
// A session can span multiple harness-side conversations: when the
// cursor-runner's resume fails, it creates a fresh Cursor agent and replaces
// harness_state_id via a normal session update. The replaced id must not be
// destroyed — billing reconciliation joins Cursor ledger events on the union
// of current + prior ids, and every turn that ran under a replaced id would
// otherwise become an orphaned ledger event.
//
// The history is computed here, from the observed harness_state_id
// transition, and never taken from client input: BuildUpdateState performs
// full spec replacement, so a stale client resending an old spec would
// silently clobber a client-writable history. Resetting it from the existing
// record makes the server the single writer of this field.
//
// Must run after BuildUpdateState (it mutates the merged state) and before
// Persist.
type RecordHarnessStateHistoryStep struct{}

func NewRecordHarnessStateHistoryStep() *RecordHarnessStateHistoryStep {
	return &RecordHarnessStateHistoryStep{}
}

func (s *RecordHarnessStateHistoryStep) Name() string {
	return "RecordHarnessStateHistory"
}

func (s *RecordHarnessStateHistoryStep) Execute(ctx *pipeline.RequestContext[*sessionv1.Session]) error {
	merged := ctx.NewState()
	mergedSpec := merged.GetSpec()
	if mergedSpec == nil {
		return nil
	}

	existingVal := ctx.Get(steps.ExistingResourceKey)
	existing, ok := existingVal.(*sessionv1.Session)
	if !ok || existing == nil || existing.GetSpec() == nil {
		return nil
	}
	existingSpec := existing.GetSpec()

	// Server-owned: the merged state carries whatever the client sent for
	// this field — discard it and rebuild from the stored history.
	history := slices.Clone(existingSpec.GetHarnessStateIdHistory())

	previousID := existingSpec.GetHarnessStateId()
	if previousID != "" && previousID != mergedSpec.GetHarnessStateId() &&
		!slices.Contains(history, previousID) {
		history = append(history, previousID)
	}

	mergedSpec.HarnessStateIdHistory = history
	return nil
}

package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// ValidateHarnessImmutabilityStep rejects session updates that attempt to
// change the harness after the session has been used for execution.
//
// Each harness owns its conversation state independently (LangGraph uses
// Stigmer checkpoints via harness_state_id; Cursor uses a Cursor-hosted Agent
// via cursor_agent_id in harness_state_id). Switching harness mid-session would
// silently discard conversation history.
//
// A session is considered "used" when its harness_state_id is non-empty, which
// is set after the first execution completes.
type ValidateHarnessImmutabilityStep struct{}

func NewValidateHarnessImmutabilityStep() *ValidateHarnessImmutabilityStep {
	return &ValidateHarnessImmutabilityStep{}
}

func (s *ValidateHarnessImmutabilityStep) Name() string {
	return "ValidateHarnessImmutability"
}

func (s *ValidateHarnessImmutabilityStep) Execute(ctx *pipeline.RequestContext[*sessionv1.Session]) error {
	input := ctx.Input()

	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return nil
	}

	existing, ok := existingVal.(*sessionv1.Session)
	if !ok || existing == nil {
		return nil
	}

	existingSpec := existing.GetSpec()
	if existingSpec == nil {
		return nil
	}

	// Session has not been used yet — harness can still change.
	if existingSpec.GetHarnessStateId() == "" {
		return nil
	}

	inputSpec := input.GetSpec()
	if inputSpec == nil {
		return nil
	}

	existingHarness := existingSpec.GetHarness()
	inputHarness := inputSpec.GetHarness()

	// Treat UNSPECIFIED as NATIVE for comparison.
	if existingHarness == sessionv1.Harness_HARNESS_UNSPECIFIED {
		existingHarness = sessionv1.Harness_HARNESS_NATIVE
	}
	if inputHarness == sessionv1.Harness_HARNESS_UNSPECIFIED {
		inputHarness = sessionv1.Harness_HARNESS_NATIVE
	}

	if inputHarness != existingHarness {
		return grpclib.FailedPreconditionError(
			"session harness cannot be changed after the first execution — " +
				"each harness owns its conversation state independently")
	}

	return nil
}

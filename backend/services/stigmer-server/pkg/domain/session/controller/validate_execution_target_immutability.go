package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// ValidateExecutionTargetImmutabilityStep rejects session updates that attempt
// to change the execution_target after the session has been used for execution.
//
// Workspace state may not be portable between local and cloud environments.
// A session running on a client's embedded runner (LOCAL) has local filesystem
// state; switching to CLOUD mid-session would lose that state, and vice versa.
//
// Uses the same sentinel as harness immutability: harness_state_id is non-empty
// after the first execution completes.
type ValidateExecutionTargetImmutabilityStep struct{}

func NewValidateExecutionTargetImmutabilityStep() *ValidateExecutionTargetImmutabilityStep {
	return &ValidateExecutionTargetImmutabilityStep{}
}

func (s *ValidateExecutionTargetImmutabilityStep) Name() string {
	return "ValidateExecutionTargetImmutability"
}

func (s *ValidateExecutionTargetImmutabilityStep) Execute(ctx *pipeline.RequestContext[*sessionv1.Session]) error {
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

	if existingSpec.GetHarnessStateId() == "" {
		return nil
	}

	inputSpec := input.GetSpec()
	if inputSpec == nil {
		return nil
	}

	existingTarget := existingSpec.GetExecutionTarget()
	inputTarget := inputSpec.GetExecutionTarget()

	// Treat UNSPECIFIED as equivalent — it is resolved at dispatch time,
	// so UNSPECIFIED→LOCAL and LOCAL→UNSPECIFIED are not meaningful changes.
	if existingTarget == sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		existingTarget = sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
	}
	if inputTarget == sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		inputTarget = sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
	}

	if inputTarget != existingTarget {
		return grpclib.FailedPreconditionError(
			"session execution_target cannot be changed after the first execution — " +
				"workspace state may not be portable between local and cloud environments")
	}

	return nil
}

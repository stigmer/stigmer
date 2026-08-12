package session

import (
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
)

// ValidateExecutionTargetImmutabilityStep rejects session updates that attempt
// to change the execution_target after the session has been used for execution.
//
// Workspace state may not be portable between local and cloud environments.
// A session running on a client's embedded runner (LOCAL) has local filesystem
// state; switching to CLOUD mid-session would lose that state, and vice versa.
//
// UNSPECIFIED is compared by what dispatch would actually do with it: both the
// existing and the input target are resolved through the same deployment
// default dispatch uses (Config.ResolveExecutionTarget — LOCAL on OSS, CLOUD
// on hosted deployments), so "no effective change" and "no dispatch change"
// are the same predicate on every deployment. Hardcoding UNSPECIFIED to a
// fixed target here would refuse round-trips that change nothing on
// cloud-defaulting deployments and wave through updates that really do move
// the session (oss#397).
//
// Uses the same sentinel as harness immutability: harness_state_id is non-empty
// after the first execution completes.
type ValidateExecutionTargetImmutabilityStep struct {
	temporalConfig *agentexecutiontemporal.Config
}

func NewValidateExecutionTargetImmutabilityStep(
	temporalConfig *agentexecutiontemporal.Config,
) *ValidateExecutionTargetImmutabilityStep {
	return &ValidateExecutionTargetImmutabilityStep{temporalConfig: temporalConfig}
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

	existingTarget := s.temporalConfig.ResolveExecutionTarget(existingSpec.GetExecutionTarget())
	inputTarget := s.temporalConfig.ResolveExecutionTarget(inputSpec.GetExecutionTarget())

	if inputTarget != existingTarget {
		return grpclib.FailedPreconditionError(
			"session execution_target cannot be changed after the first execution (%s → %s; "+
				"unset resolves to the deployment default, %s) — "+
				"workspace state may not be portable between local and cloud environments",
			existingTarget, inputTarget, s.temporalConfig.DefaultExecutionTarget)
	}

	return nil
}

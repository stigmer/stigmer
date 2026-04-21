package agentrunner

import (
	"context"

	"github.com/rs/zerolog/log"
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing AgentRunner resource.
//
// Only spec fields (description) are user-mutable. Status fields (phase,
// task_queue, heartbeat, current_executions, connection_info) are exclusively
// managed by the heartbeat RPC and server-side transitions.
//
// Pipeline (Stigmer OSS — simplified from Cloud):
//  1. ValidateFieldConstraints — validate proto field constraints using buf validate
//  2. ResolveSlug — resolve slug from name for lookup
//  3. LoadExisting — load current runner from repository by ID
//  4. BuildUpdateState — merge spec, preserve IDs, update timestamps, clear status
//  5. PreserveRunnerStatus — restore status from existing resource
//  6. Persist — save updated runner
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
//   - SendResponse step (handler returns directly)
func (c *AgentRunnerController) Update(ctx context.Context, runner *agentrunnerv1.AgentRunner) (*agentrunnerv1.AgentRunner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runner)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentRunnerController) buildUpdatePipeline() *pipeline.Pipeline[*agentrunnerv1.AgentRunner] {
	return pipeline.NewPipeline[*agentrunnerv1.AgentRunner]("agent-runner-update").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.AgentRunner]()).        // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentrunnerv1.AgentRunner]()).          // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*agentrunnerv1.AgentRunner](c.store)). // 3. Load existing runner
		AddStep(steps.NewBuildUpdateStateStep[*agentrunnerv1.AgentRunner]()).     // 4. Build updated state (clears status)
		AddStep(&preserveRunnerStatusStep{}).                                     // 5. Restore status from existing
		AddStep(steps.NewPersistStep[*agentrunnerv1.AgentRunner](c.store)).      // 6. Persist
		Build()
}

// preserveRunnerStatusStep restores the status from the existing AgentRunner
// after BuildUpdateState clears it.
//
// The framework's BuildUpdateState correctly strips status from the input
// request (status is not user-mutable). This step copies the existing status
// back onto the new state so it is preserved through the persist step.
//
// This enforces the invariant: status is only modifiable via heartbeat and
// server-side phase transitions — never via the update RPC.
type preserveRunnerStatusStep struct{}

func (s *preserveRunnerStatusStep) Name() string {
	return "PreserveRunnerStatus"
}

func (s *preserveRunnerStatusStep) Execute(ctx *pipeline.RequestContext[*agentrunnerv1.AgentRunner]) error {
	existing := ctx.Get(steps.ExistingResourceKey)
	if existing == nil {
		return nil
	}

	existingRunner := existing.(*agentrunnerv1.AgentRunner)
	newState := ctx.NewState()

	newState.Status = existingRunner.GetStatus()
	ctx.SetNewState(newState)

	log.Debug().
		Str("runner_id", existingRunner.GetMetadata().GetId()).
		Str("phase", existingRunner.GetStatus().GetPhase().String()).
		Msg("Preserved runner status from existing state")

	return nil
}

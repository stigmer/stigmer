package agentrunner

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new AgentRunner resource.
//
// Pipeline (Stigmer OSS — simplified from Cloud):
//  1. ValidateFieldConstraints — validate proto field constraints using buf validate
//  2. ResolveSlug — generate slug from metadata.name
//  3. CheckDuplicate — verify no duplicate exists by org + slug
//  4. BuildNewState — generate ID, clear status, set audit fields
//  5. InitializeRunnerStatus — set task_queue ("agent-runner:{id}") and phase PENDING
//  6. Persist — save runner to repository
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - CreateAuthorizationTuples step (no FGA in OSS)
//   - SendResponse step (handler returns directly)
func (c *AgentRunnerController) Create(ctx context.Context, runner *agentrunnerv1.AgentRunner) (*agentrunnerv1.AgentRunner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runner)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentRunnerController) buildCreatePipeline() *pipeline.Pipeline[*agentrunnerv1.AgentRunner] {
	return pipeline.NewPipeline[*agentrunnerv1.AgentRunner]("agent-runner-create").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.AgentRunner]()).      // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentrunnerv1.AgentRunner]()).        // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentrunnerv1.AgentRunner](c.store)). // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*agentrunnerv1.AgentRunner]()).      // 4. Build new state (ID, audit)
		AddStep(&initializeRunnerStatusStep{}).                                 // 5. Set task_queue + PENDING
		AddStep(steps.NewPersistStep[*agentrunnerv1.AgentRunner](c.store)).    // 6. Persist
		Build()
}

// initializeRunnerStatusStep sets server-managed status fields on a newly created AgentRunner.
//
// After BuildNewState generates the resource ID, this step sets:
//   - status.task_queue — "agent-runner:{metadata.id}", immutable after create
//   - status.phase — PENDING, waiting for first heartbeat
//
// The task queue name is deterministic from the runner ID and is the routing
// key used by the execution dispatch logic to send work to this runner.
type initializeRunnerStatusStep struct{}

func (s *initializeRunnerStatusStep) Name() string {
	return "InitializeRunnerStatus"
}

func (s *initializeRunnerStatusStep) Execute(ctx *pipeline.RequestContext[*agentrunnerv1.AgentRunner]) error {
	runner := ctx.NewState()
	runnerID := runner.GetMetadata().GetId()
	taskQueue := fmt.Sprintf("agent-runner:%s", runnerID)

	log.Info().
		Str("runner_id", runnerID).
		Str("task_queue", taskQueue).
		Msg("Initializing runner status")

	runner.Status = &agentrunnerv1.AgentRunnerStatus{
		Phase:     agentrunnerv1.AgentRunnerPhase_AGENT_RUNNER_PHASE_PENDING,
		TaskQueue: taskQueue,
	}

	ctx.SetNewState(runner)
	return nil
}

package agentexecution

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// Update updates an existing agent execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints
// 2. ResolveSlug - Resolve slug (for fallback slug lookup)
// 3. LoadExisting - Load existing execution from repository
// 4. BuildUpdateState - Standard build (updates spec, clears status per standard pattern)
// 5. Persist - Save to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
//
// Design Note: This handler is for USER-initiated spec updates.
// Status updates from agent-runner use UpdateStatus handler instead.
func (c *AgentExecutionController) Update(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, execution)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for agent execution updates
func (c *AgentExecutionController) buildUpdatePipeline() *pipeline.Pipeline[*agentexecutionv1.AgentExecution] {
	return pipeline.NewPipeline[*agentexecutionv1.AgentExecution]("agent-execution-update").
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.AgentExecution]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentexecutionv1.AgentExecution]()).         // 2. Resolve slug (for fallback)
		AddStep(steps.NewLoadExistingStep[*agentexecutionv1.AgentExecution](c.store)). // 3. Load existing
		AddStep(steps.NewBuildUpdateStateStep[*agentexecutionv1.AgentExecution]()).    // 4. Build new state
		AddStep(steps.NewPersistStep[*agentexecutionv1.AgentExecution](c.store)).      // 5. Persist
		Build()
}

package agentexecution

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
)

// Get retrieves a single agent execution by ID using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. LoadTarget - Extract ID from AgentExecutionId wrapper and load execution from repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentExecutionController) Get(ctx context.Context, executionId *agentexecutionv1.AgentExecutionId) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return the loaded resource from context (set by LoadTargetForGet step)
	return reqCtx.Get(steps.TargetResourceKey).(*agentexecutionv1.AgentExecution), nil
}

// buildGetPipeline constructs the pipeline for agent execution retrieval
func (c *AgentExecutionController) buildGetPipeline() *pipeline.Pipeline[*agentexecutionv1.AgentExecutionId] {
	return pipeline.NewPipeline[*agentexecutionv1.AgentExecutionId]("agent-execution-get").
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.AgentExecutionId]()).                                       // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*agentexecutionv1.AgentExecutionId, *agentexecutionv1.AgentExecution](c.store)). // 2. Load target
		Build()
}

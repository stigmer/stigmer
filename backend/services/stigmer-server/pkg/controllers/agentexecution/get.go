package agentexecution

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
)

// Get retrieves a single agent execution by ID
//
// Pipeline Steps (direct implementation):
// 1. Validate input ID
// 2. Load execution from repository
// 3. Return execution
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentExecutionController) Get(ctx context.Context, executionId *agentexecutionv1.AgentExecutionId) (*agentexecutionv1.AgentExecution, error) {
	if executionId == nil || executionId.Value == "" {
		return nil, grpclib.InvalidArgumentError("execution id is required")
	}

	execution := &agentexecutionv1.AgentExecution{}
	if err := c.store.GetResource(ctx, "AgentExecution", executionId.Value, execution); err != nil {
		return nil, grpclib.NotFoundError("AgentExecution", executionId.Value)
	}

	return execution, nil
}

package agentexecution

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Delete deletes an agent execution
//
// Pipeline Steps (direct implementation):
// 1. Validate input ID
// 2. Load execution from repository
// 3. Delete from database
// 4. Return deleted execution for audit trail
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CleanupIamPolicies step (no IAM/FGA in OSS)
func (c *AgentExecutionController) Delete(ctx context.Context, executionId *apiresource.ApiResourceId) (*agentexecutionv1.AgentExecution, error) {
	if executionId == nil || executionId.Value == "" {
		return nil, grpclib.InvalidArgumentError("execution id is required")
	}

	// Load execution before deletion (gRPC convention: return deleted resource)
	execution := &agentexecutionv1.AgentExecution{}
	if err := c.store.GetResource(ctx, "AgentExecution", executionId.Value, execution); err != nil {
		return nil, grpclib.NotFoundError("AgentExecution", executionId.Value)
	}

	// Delete from store
	if err := c.store.DeleteResource(ctx, "AgentExecution", executionId.Value); err != nil {
		return nil, grpclib.InternalError(err, "failed to delete agent execution")
	}

	return execution, nil
}

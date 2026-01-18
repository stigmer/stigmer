package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/proto"
)

// UpdateStatus updates execution status during agent execution
//
// Used by agent-runner to send progressive status updates (messages, tool_calls, phase, etc.)
// This RPC is optimized for frequent status updates and merges status fields with existing state.
//
// Pipeline Steps (direct implementation):
// 1. Validate input
// 2. Load existing execution
// 3. Merge status fields
// 4. Persist updated execution
// 5. Return updated execution
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - PublishToRedis step (no Redis in OSS)
// - Publish step (no event publishing in OSS)
func (c *AgentExecutionController) UpdateStatus(ctx context.Context, input *agentexecutionv1.AgentExecutionUpdateStatusInput) (*agentexecutionv1.AgentExecution, error) {
	// 1. Validate input
	if input == nil {
		return nil, grpclib.InvalidArgumentError("input is required")
	}

	executionID := input.ExecutionId
	if executionID == "" {
		return nil, grpclib.InvalidArgumentError("execution_id is required")
	}

	if input.Status == nil {
		return nil, grpclib.InvalidArgumentError("status is required")
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Updating execution status")

	// 2. Load existing execution
	existing := &agentexecutionv1.AgentExecution{}
	if err := c.store.GetResource(ctx, "AgentExecution", executionID, existing); err != nil{
		return nil, grpclib.NotFoundError("AgentExecution", executionID)
	}

	// 3. Merge status fields
	// The input contains only the status fields to be updated
	// We merge them with the existing execution's status
	if existing.Status == nil {
		existing.Status = &agentexecutionv1.AgentExecutionStatus{}
	}

	// Merge status fields using proto.Merge
	// This will update only the fields present in input.Status
	proto.Merge(existing.Status, input.Status)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", existing.Status.Phase.String()).
		Int("messages_count", len(existing.Status.Messages)).
		Int("tool_calls_count", len(existing.Status.ToolCalls)).
		Msg("Merged status fields")

	// 4. Persist updated execution
	if err := c.store.SaveResource(ctx, "AgentExecution", executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to persist execution with updated status")
		return nil, grpclib.InternalError(err, "failed to update execution status")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("phase", existing.Status.Phase.String()).
		Msg("Successfully updated execution status")

	return existing, nil
}

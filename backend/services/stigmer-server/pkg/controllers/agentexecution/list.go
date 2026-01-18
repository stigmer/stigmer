package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// List retrieves all agent executions with pagination and optional filtering
//
// Note: For OSS (local single-user), we return all executions without authorization.
// Pagination and filtering can be added later as needed.
func (c *AgentExecutionController) List(ctx context.Context, req *agentexecutionv1.ListAgentExecutionsRequest) (*agentexecutionv1.AgentExecutionList, error) {
	log.Debug().Msg("Listing all agent executions")

	// List all executions from store
	data, err := c.store.ListResources(ctx, "AgentExecution")
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agent executions")
	}

	executions := make([]*agentexecutionv1.AgentExecution, 0, len(data))
	for _, d := range data {
		execution := &agentexecutionv1.AgentExecution{}
		if err := protojson.Unmarshal(d, execution); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal execution, skipping")
			continue
		}

		// Apply phase filter if provided
		if req.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
			if execution.GetStatus().GetPhase() != req.Phase {
				continue
			}
		}

		executions = append(executions, execution)
	}

	log.Debug().
		Int("count", len(executions)).
		Msg("Successfully listed executions")

	return &agentexecutionv1.AgentExecutionList{
		TotalPages: 1, // TODO: Implement pagination
		Entries:    executions,
	}, nil
}

// ListBySession lists all executions in a specific session
//
// Note: For OSS, we filter executions by session_id without authorization.
func (c *AgentExecutionController) ListBySession(ctx context.Context, req *agentexecutionv1.ListAgentExecutionsBySessionRequest) (*agentexecutionv1.AgentExecutionList, error) {
	if req == nil || req.SessionId == "" {
		return nil, grpclib.InvalidArgumentError("session_id is required")
	}

	sessionID := req.SessionId

	log.Debug().
		Str("session_id", sessionID).
		Msg("Listing executions by session")

	// List all executions and filter by session_id
	data, err := c.store.ListResources(ctx, "AgentExecution")
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agent executions")
	}

	executions := make([]*agentexecutionv1.AgentExecution, 0)
	for _, d := range data {
		execution := &agentexecutionv1.AgentExecution{}
		if err := protojson.Unmarshal(d, execution); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal execution, skipping")
			continue
		}

		// Filter by session_id
		if execution.GetSpec().GetSessionId() == sessionID {
			executions = append(executions, execution)
		}
	}

	log.Debug().
		Str("session_id", sessionID).
		Int("count", len(executions)).
		Msg("Successfully listed executions by session")

	return &agentexecutionv1.AgentExecutionList{
		TotalPages: 1, // TODO: Implement pagination
		Entries:    executions,
	}, nil
}

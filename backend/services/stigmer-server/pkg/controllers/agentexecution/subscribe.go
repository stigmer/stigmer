package agentexecution

import (
	"time"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
)

// Subscribe provides real-time execution updates via gRPC streaming
//
// For OSS: This is a simplified implementation that polls the database.
// In Cloud, this uses Redis Streams for true real-time updates.
//
// TODO: Implement proper streaming with file watchers or similar mechanism
func (c *AgentExecutionController) Subscribe(executionId *agentexecutionv1.AgentExecutionId, stream agentexecutionv1.AgentExecutionQueryController_SubscribeServer) error {
	if executionId == nil || executionId.Value == "" {
		return grpclib.InvalidArgumentError("execution id is required")
	}

	executionID := executionId.Value

	log.Info().
		Str("execution_id", executionID).
		Msg("Starting execution subscription")

	// Verify execution exists
	execution := &agentexecutionv1.AgentExecution{}
	if err := c.store.GetResource(stream.Context(), "AgentExecution", executionID, execution); err != nil {
		return grpclib.NotFoundError("AgentExecution", executionID)
	}

	// Send initial state
	if err := stream.Send(execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to send initial execution state")
		return grpclib.InternalError(err, "failed to send execution state")
	}

	// Poll for updates (simplified implementation for OSS)
	// TODO: Replace with proper event-driven mechanism
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	lastPhase := execution.GetStatus().GetPhase()
	lastMessageCount := len(execution.GetStatus().GetMessages())

	for {
		select {
		case <-stream.Context().Done():
			log.Info().
				Str("execution_id", executionID).
				Msg("Subscription cancelled by client")
			return nil

		case <-ticker.C:
			// Load latest state
			updated := &agentexecutionv1.AgentExecution{}
			if err := c.store.GetResource(stream.Context(), "AgentExecution", executionID, updated); err != nil {
				log.Error().
					Err(err).
					Str("execution_id", executionID).
					Msg("Failed to load execution during subscription")
				continue
			}

			// Check if execution has changed
			currentPhase := updated.GetStatus().GetPhase()
			currentMessageCount := len(updated.GetStatus().GetMessages())

			if currentPhase != lastPhase || currentMessageCount != lastMessageCount {
				// Send updated state
				if err := stream.Send(updated); err != nil {
					log.Error().
						Err(err).
						Str("execution_id", executionID).
						Msg("Failed to send updated execution state")
					return grpclib.InternalError(err, "failed to send execution updates")
				}

				log.Debug().
					Str("execution_id", executionID).
					Str("phase", currentPhase.String()).
					Int("messages", currentMessageCount).
					Msg("Sent execution update")

				lastPhase = currentPhase
				lastMessageCount = currentMessageCount
			}

			// Check if execution is in terminal state
			if isTerminalPhase(currentPhase) {
				log.Info().
					Str("execution_id", executionID).
					Str("phase", currentPhase.String()).
					Msg("Execution reached terminal state, ending subscription")
				return nil
			}
		}
	}
}

// isTerminalPhase checks if the execution phase is terminal
func isTerminalPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}

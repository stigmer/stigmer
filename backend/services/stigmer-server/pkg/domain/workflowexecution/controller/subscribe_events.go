package workflowexecution

import (
	"time"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
)

const eventPollInterval = 500 * time.Millisecond

// SubscribeEvents streams individual WorkflowExecutionEvent messages in real-time.
//
// Unlike Subscribe (which streams full WorkflowExecution snapshots), this streams
// lightweight incremental events suitable for the execution viewer timeline.
//
// Replay + Live Tail:
//   - Replays persisted events with sequence_number > after_sequence
//   - Then polls SQLite every 500ms for new events
//   - Closes when the execution reaches a terminal phase or the client disconnects
func (c *WorkflowExecutionController) SubscribeEvents(req *workflowexecutionv1.SubscribeEventsRequest, stream workflowexecutionv1.WorkflowExecutionQueryController_SubscribeEventsServer) error {
	ctx := stream.Context()

	if req == nil || req.ExecutionId == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	executionID := req.ExecutionId

	// Verify execution exists
	execution := &workflowexecutionv1.WorkflowExecution{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution); err != nil {
		return grpclib.NotFoundError("WorkflowExecution", executionID)
	}

	// Build event type filter set
	var typeFilter map[string]struct{}
	if len(req.EventTypes) > 0 {
		typeFilter = make(map[string]struct{}, len(req.EventTypes))
		for _, et := range req.EventTypes {
			typeFilter[et.String()] = struct{}{}
		}
	}

	cursor := int64(req.AfterSequence)

	log.Info().
		Str("execution_id", executionID).
		Int64("after_sequence", cursor).
		Msg("Starting event subscription")

	ticker := time.NewTicker(eventPollInterval)
	defer ticker.Stop()

	for {
		// Poll for new events
		records, err := c.store.GetWorkflowExecutionEvents(ctx, executionID, cursor, "", "", defaultEventPageSize)
		if err != nil {
			log.Error().Err(err).
				Str("execution_id", executionID).
				Msg("Failed to poll execution events")
			return grpclib.InternalError(err, "failed to poll execution events")
		}

		for _, rec := range records {
			// Apply type filter
			if typeFilter != nil {
				if _, ok := typeFilter[rec.EventType]; !ok {
					cursor = rec.SequenceNumber
					continue
				}
			}

			evt := &workflowexecutionv1.WorkflowExecutionEvent{}
			if err := proto.Unmarshal(rec.Data, evt); err != nil {
				log.Warn().Err(err).
					Str("execution_id", executionID).
					Int64("sequence_number", rec.SequenceNumber).
					Msg("Skipping malformed event record")
				cursor = rec.SequenceNumber
				continue
			}

			if err := stream.Send(evt); err != nil {
				log.Debug().Err(err).
					Str("execution_id", executionID).
					Msg("Client disconnected from event stream")
				return nil
			}

			cursor = rec.SequenceNumber
		}

		// Check if execution has reached a terminal state
		if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution); err == nil {
			if isWorkflowTerminalPhase(execution.GetStatus().GetPhase()) {
				// Drain any remaining events after terminal state
				remaining, _ := c.store.GetWorkflowExecutionEvents(ctx, executionID, cursor, "", "", defaultEventPageSize)
				for _, rec := range remaining {
					if typeFilter != nil {
						if _, ok := typeFilter[rec.EventType]; !ok {
							continue
						}
					}
					evt := &workflowexecutionv1.WorkflowExecutionEvent{}
					if err := proto.Unmarshal(rec.Data, evt); err != nil {
						continue
					}
					if err := stream.Send(evt); err != nil {
						return nil
					}
				}

				log.Info().
					Str("execution_id", executionID).
					Str("phase", execution.GetStatus().GetPhase().String()).
					Msg("Execution reached terminal state, closing event stream")
				return nil
			}
		}

		// Wait for next poll or context cancellation
		select {
		case <-ctx.Done():
			log.Info().
				Str("execution_id", executionID).
				Msg("Event subscription cancelled by client")
			return nil
		case <-ticker.C:
			// Continue polling
		}
	}
}

package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
)

const (
	defaultEventPageSize = 100
	maxEventPageSize     = 500
)

// GetEventLog returns a paginated list of execution events.
//
// Supports cursor-based pagination via after_sequence and optional filtering
// by event type or task name. Events are returned in sequence_number ascending order.
func (c *WorkflowExecutionController) GetEventLog(ctx context.Context, req *workflowexecutionv1.GetEventLogRequest) (*workflowexecutionv1.GetEventLogResponse, error) {
	if req == nil || req.ExecutionId == "" {
		return nil, grpclib.InvalidArgumentError("execution_id is required")
	}

	pageSize := int(req.PageSize)
	if pageSize <= 0 {
		pageSize = defaultEventPageSize
	}
	if pageSize > maxEventPageSize {
		pageSize = maxEventPageSize
	}

	// Map event_types filter to a single string for the store query.
	// The store supports filtering by one event type; if the request has
	// multiple types, we fetch all and filter in memory.
	var eventTypeFilter string
	if len(req.EventTypes) == 1 {
		eventTypeFilter = req.EventTypes[0].String()
	}

	// Fetch one extra record to determine has_more
	records, err := c.store.GetWorkflowExecutionEvents(
		ctx,
		req.ExecutionId,
		int64(req.AfterSequence),
		eventTypeFilter,
		req.TaskName,
		pageSize+1,
	)
	if err != nil {
		log.Error().Err(err).
			Str("execution_id", req.ExecutionId).
			Msg("Failed to query execution events")
		return nil, grpclib.InternalError(err, "failed to query execution events")
	}

	hasMore := len(records) > pageSize
	if hasMore {
		records = records[:pageSize]
	}

	// Build multi-type filter set for in-memory filtering when >1 event type is requested
	var typeFilter map[string]struct{}
	if len(req.EventTypes) > 1 {
		typeFilter = make(map[string]struct{}, len(req.EventTypes))
		for _, et := range req.EventTypes {
			typeFilter[et.String()] = struct{}{}
		}
	}

	events := make([]*workflowexecutionv1.WorkflowExecutionEvent, 0, len(records))
	var latestSeq uint64

	for _, rec := range records {
		// Apply multi-type filter if needed
		if typeFilter != nil {
			if _, ok := typeFilter[rec.EventType]; !ok {
				continue
			}
		}

		evt := &workflowexecutionv1.WorkflowExecutionEvent{}
		if err := proto.Unmarshal(rec.Data, evt); err != nil {
			log.Warn().Err(err).
				Str("execution_id", req.ExecutionId).
				Int64("sequence_number", rec.SequenceNumber).
				Msg("Skipping malformed event record")
			continue
		}

		events = append(events, evt)
		if uint64(rec.SequenceNumber) > latestSeq {
			latestSeq = uint64(rec.SequenceNumber)
		}
	}

	return &workflowexecutionv1.GetEventLogResponse{
		Events:         events,
		HasMore:        hasMore,
		LatestSequence: latestSeq,
	}, nil
}

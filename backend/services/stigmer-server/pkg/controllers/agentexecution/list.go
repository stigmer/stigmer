package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// Context keys for list operations
const (
	ExecutionListKey = "execution_list"
)

// List retrieves all agent executions with pagination and optional filtering
//
// Pipeline (Stigmer OSS):
// 1. Validate - Validate input request
// 2. QueryAll - List all executions from store
// 3. ApplyPhaseFilter - Filter by phase if provided
//
// Note: For OSS (local single-user), we return all executions without authorization.
// Pagination and filtering can be added later as needed.
func (c *AgentExecutionController) List(ctx context.Context, req *agentexecutionv1.ListAgentExecutionsRequest) (*agentexecutionv1.AgentExecutionList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return execution list from context
	result, ok := reqCtx.Get(ExecutionListKey).(*agentexecutionv1.AgentExecutionList)
	if !ok {
		return nil, grpclib.InternalError(nil, "execution list not found in context")
	}

	return result, nil
}

// buildListPipeline constructs the pipeline for listing agent executions
func (c *AgentExecutionController) buildListPipeline() *pipeline.Pipeline[*agentexecutionv1.ListAgentExecutionsRequest] {
	return pipeline.NewPipeline[*agentexecutionv1.ListAgentExecutionsRequest]("agent-execution-list").
		AddStep(c.newValidateListRequestStep()).            // 1. Validate request
		AddStep(c.newQueryAllExecutionsStep()).             // 2. Query all executions
		AddStep(c.newApplyPhaseFilterStep()).               // 3. Apply phase filter
		AddStep(c.newBuildListExecutionListResponseStep()). // 4. Build response
		Build()
}

// ListBySession lists all executions in a specific session
//
// Pipeline (Stigmer OSS):
// 1. Validate - Validate session_id is provided
// 2. QueryBySession - List executions filtered by session_id
//
// Note: For OSS, we filter executions by session_id without authorization.
func (c *AgentExecutionController) ListBySession(ctx context.Context, req *agentexecutionv1.ListAgentExecutionsBySessionRequest) (*agentexecutionv1.AgentExecutionList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListBySessionPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return execution list from context
	result, ok := reqCtx.Get(ExecutionListKey).(*agentexecutionv1.AgentExecutionList)
	if !ok {
		return nil, grpclib.InternalError(nil, "execution list not found in context")
	}

	return result, nil
}

// buildListBySessionPipeline constructs the pipeline for listing executions by session
func (c *AgentExecutionController) buildListBySessionPipeline() *pipeline.Pipeline[*agentexecutionv1.ListAgentExecutionsBySessionRequest] {
	return pipeline.NewPipeline[*agentexecutionv1.ListAgentExecutionsBySessionRequest]("agent-execution-list-by-session").
		AddStep(c.newValidateListBySessionRequestStep()).            // 1. Validate request
		AddStep(c.newQueryExecutionsBySessionStep()).                // 2. Query by session
		AddStep(c.newBuildListBySessionExecutionListResponseStep()). // 3. Build response
		Build()
}

// ============================================================================
// Pipeline Steps for List Operations
// ============================================================================

// validateListRequestStep validates the list request
type validateListRequestStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newValidateListRequestStep() *validateListRequestStep {
	return &validateListRequestStep{controller: c}
}

func (s *validateListRequestStep) Name() string {
	return "ValidateListRequest"
}

func (s *validateListRequestStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsRequest]) error {
	log.Debug().Msg("Validating list request")
	// For now, list request has no required fields
	// Future: Add pagination validation here
	return nil
}

// queryAllExecutionsStep queries all executions from the store
type queryAllExecutionsStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newQueryAllExecutionsStep() *queryAllExecutionsStep {
	return &queryAllExecutionsStep{controller: c}
}

func (s *queryAllExecutionsStep) Name() string {
	return "QueryAllExecutions"
}

func (s *queryAllExecutionsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsRequest]) error {
	log.Debug().Msg("Listing all agent executions")

	// List all executions from store
	data, err := s.controller.store.ListResources(ctx.Context(), "AgentExecution")
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent executions")
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
		executions = append(executions, execution)
	}

	log.Debug().
		Int("count", len(executions)).
		Msg("Successfully queried executions")

	// Store executions in context
	ctx.Set(ExecutionListKey, executions)

	return nil
}

// applyPhaseFilterStep applies phase filter to execution list
type applyPhaseFilterStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newApplyPhaseFilterStep() *applyPhaseFilterStep {
	return &applyPhaseFilterStep{controller: c}
}

func (s *applyPhaseFilterStep) Name() string {
	return "ApplyPhaseFilter"
}

func (s *applyPhaseFilterStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsRequest]) error {
	req := ctx.Input()
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	// If no phase filter specified, skip filtering
	if req.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		log.Debug().Msg("No phase filter specified, skipping")
		return nil
	}

	log.Debug().
		Str("phase", req.Phase.String()).
		Msg("Applying phase filter")

	// Filter executions by phase
	filtered := make([]*agentexecutionv1.AgentExecution, 0)
	for _, execution := range executions {
		if execution.GetStatus().GetPhase() == req.Phase {
			filtered = append(filtered, execution)
		}
	}

	log.Debug().
		Int("original_count", len(executions)).
		Int("filtered_count", len(filtered)).
		Msg("Phase filter applied")

	// Update execution list in context
	ctx.Set(ExecutionListKey, filtered)

	return nil
}

// validateListBySessionRequestStep validates the list by session request
type validateListBySessionRequestStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newValidateListBySessionRequestStep() *validateListBySessionRequestStep {
	return &validateListBySessionRequestStep{controller: c}
}

func (s *validateListBySessionRequestStep) Name() string {
	return "ValidateListBySessionRequest"
}

func (s *validateListBySessionRequestStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsBySessionRequest]) error {
	req := ctx.Input()

	log.Debug().Msg("Validating list by session request")

	if req == nil || req.SessionId == "" {
		log.Warn().Msg("session_id is required")
		return grpclib.InvalidArgumentError("session_id is required")
	}

	log.Debug().
		Str("session_id", req.SessionId).
		Msg("Validation successful")

	return nil
}

// queryExecutionsBySessionStep queries executions filtered by session ID
type queryExecutionsBySessionStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newQueryExecutionsBySessionStep() *queryExecutionsBySessionStep {
	return &queryExecutionsBySessionStep{controller: c}
}

func (s *queryExecutionsBySessionStep) Name() string {
	return "QueryExecutionsBySession"
}

func (s *queryExecutionsBySessionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsBySessionRequest]) error {
	req := ctx.Input()
	sessionID := req.SessionId

	log.Debug().
		Str("session_id", sessionID).
		Msg("Listing executions by session")

	// List all executions and filter by session_id
	data, err := s.controller.store.ListResources(ctx.Context(), "AgentExecution")
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent executions")
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
		Msg("Successfully queried executions by session")

	// Store executions in context
	ctx.Set(ExecutionListKey, executions)

	return nil
}

// buildListExecutionListResponseStep builds the AgentExecutionList response for List operation
type buildListExecutionListResponseStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newBuildListExecutionListResponseStep() *buildListExecutionListResponseStep {
	return &buildListExecutionListResponseStep{controller: c}
}

func (s *buildListExecutionListResponseStep) Name() string {
	return "BuildExecutionListResponse"
}

func (s *buildListExecutionListResponseStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsRequest]) error {
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	log.Debug().
		Int("count", len(executions)).
		Msg("Building execution list response")

	// Build response
	result := &agentexecutionv1.AgentExecutionList{
		TotalPages: 1, // TODO: Implement pagination
		Entries:    executions,
	}

	// Store result in context
	ctx.Set(ExecutionListKey, result)

	return nil
}

// buildListBySessionExecutionListResponseStep builds the AgentExecutionList response for ListBySession operation
type buildListBySessionExecutionListResponseStep struct {
	controller *AgentExecutionController
}

func (c *AgentExecutionController) newBuildListBySessionExecutionListResponseStep() *buildListBySessionExecutionListResponseStep {
	return &buildListBySessionExecutionListResponseStep{controller: c}
}

func (s *buildListBySessionExecutionListResponseStep) Name() string {
	return "BuildExecutionListResponse"
}

func (s *buildListBySessionExecutionListResponseStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsBySessionRequest]) error {
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	log.Debug().
		Int("count", len(executions)).
		Msg("Building execution list response")

	// Build response
	result := &agentexecutionv1.AgentExecutionList{
		TotalPages: 1, // TODO: Implement pagination
		Entries:    executions,
	}

	// Store result in context
	ctx.Set(ExecutionListKey, result)

	return nil
}

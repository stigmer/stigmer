package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
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
// 4. BuildResponse - Build final AgentExecutionList response
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
		AddStep(newValidateListRequestStep()).            // 1. Validate request
		AddStep(newQueryAllExecutionsStep(c.store)).      // 2. Query all executions
		AddStep(newApplyPhaseFilterStep()).               // 3. Apply phase filter
		AddStep(newBuildListExecutionListResponseStep()). // 4. Build response
		Build()
}

// ============================================================================
// Pipeline Steps for List Operation
// ============================================================================

// validateListRequestStep validates the list request
type validateListRequestStep struct{}

func newValidateListRequestStep() *validateListRequestStep {
	return &validateListRequestStep{}
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
	store *badger.Store
}

func newQueryAllExecutionsStep(store *badger.Store) *queryAllExecutionsStep {
	return &queryAllExecutionsStep{store: store}
}

func (s *queryAllExecutionsStep) Name() string {
	return "QueryAllExecutions"
}

func (s *queryAllExecutionsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.ListAgentExecutionsRequest]) error {
	log.Debug().Msg("Listing all agent executions")

	// List all executions from store
	data, err := s.store.ListResources(ctx.Context(), "AgentExecution")
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
type applyPhaseFilterStep struct{}

func newApplyPhaseFilterStep() *applyPhaseFilterStep {
	return &applyPhaseFilterStep{}
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

// buildListExecutionListResponseStep builds the AgentExecutionList response for List operation
type buildListExecutionListResponseStep struct{}

func newBuildListExecutionListResponseStep() *buildListExecutionListResponseStep {
	return &buildListExecutionListResponseStep{}
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

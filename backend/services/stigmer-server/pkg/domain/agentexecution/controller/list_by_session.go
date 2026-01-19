package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/encoding/protojson"
)

// ListBySession lists all executions in a specific session
//
// Pipeline (Stigmer OSS):
// 1. Validate - Validate session_id is provided
// 2. QueryBySession - List executions filtered by session_id
// 3. BuildResponse - Build final AgentExecutionList response
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
		AddStep(newValidateListBySessionRequestStep()).            // 1. Validate request
		AddStep(newQueryExecutionsBySessionStep(c.store)).         // 2. Query by session
		AddStep(newBuildListBySessionExecutionListResponseStep()). // 3. Build response
		Build()
}

// ============================================================================
// Pipeline Steps for ListBySession Operation
// ============================================================================

// validateListBySessionRequestStep validates the list by session request
type validateListBySessionRequestStep struct{}

func newValidateListBySessionRequestStep() *validateListBySessionRequestStep {
	return &validateListBySessionRequestStep{}
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
	store *badger.Store
}

func newQueryExecutionsBySessionStep(store *badger.Store) *queryExecutionsBySessionStep {
	return &queryExecutionsBySessionStep{store: store}
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
	data, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution)
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

// buildListBySessionExecutionListResponseStep builds the AgentExecutionList response for ListBySession operation
type buildListBySessionExecutionListResponseStep struct{}

func newBuildListBySessionExecutionListResponseStep() *buildListBySessionExecutionListResponseStep {
	return &buildListBySessionExecutionListResponseStep{}
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

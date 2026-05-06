package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const sessionUsageReportKey = "session_usage_report"

// GetSessionUsageReport returns aggregated usage metrics for all executions
// in a session. Provides session-level totals and per-execution breakdown.
//
// Pipeline:
// 1. Validate   -- Ensure session_id is provided
// 2. Load       -- Load all executions for the session
// 3. Aggregate  -- Compute totals, model breakdown, per-execution summaries
// 4. Respond    -- Build the GetSessionUsageReportOutput
func (c *AgentExecutionController) GetSessionUsageReport(ctx context.Context, req *agentexecutionv1.GetSessionUsageReportInput) (*agentexecutionv1.GetSessionUsageReportOutput, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetSessionUsageReportPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(sessionUsageReportKey).(*agentexecutionv1.GetSessionUsageReportOutput)
	if !ok {
		return nil, grpclib.InternalError(nil, "session usage report not found in context")
	}
	return result, nil
}

func (c *AgentExecutionController) buildGetSessionUsageReportPipeline() *pipeline.Pipeline[*agentexecutionv1.GetSessionUsageReportInput] {
	return pipeline.NewPipeline[*agentexecutionv1.GetSessionUsageReportInput]("get-session-usage-report").
		AddStep(newValidateSessionUsageReportStep()).
		AddStep(newLoadSessionExecutionsStep(c.store)).
		AddStep(newBuildSessionUsageReportStep()).
		Build()
}

// ============================================================================
// Step 1: Validate
// ============================================================================

type validateSessionUsageReportStep struct{}

func newValidateSessionUsageReportStep() *validateSessionUsageReportStep {
	return &validateSessionUsageReportStep{}
}

func (s *validateSessionUsageReportStep) Name() string { return "ValidateSessionUsageReport" }

func (s *validateSessionUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetSessionUsageReportInput]) error {
	if ctx.Input().GetSessionId() == "" {
		return grpclib.InvalidArgumentError("session_id is required")
	}
	return nil
}

// ============================================================================
// Step 2: Load executions by session
// ============================================================================

type loadSessionExecutionsStep struct {
	store store.Store
}

func newLoadSessionExecutionsStep(s store.Store) *loadSessionExecutionsStep {
	return &loadSessionExecutionsStep{store: s}
}

func (s *loadSessionExecutionsStep) Name() string { return "LoadSessionExecutions" }

func (s *loadSessionExecutionsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetSessionUsageReportInput]) error {
	sessionID := ctx.Input().GetSessionId()

	data, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent executions")
	}

	executions := make([]*agentexecutionv1.AgentExecution, 0)
	for _, d := range data {
		exec := &agentexecutionv1.AgentExecution{}
		if err := proto.Unmarshal(d, exec); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal execution, skipping")
			continue
		}
		if exec.GetSpec().GetSessionId() == sessionID {
			executions = append(executions, exec)
		}
	}

	log.Debug().
		Str("session_id", sessionID).
		Int("count", len(executions)).
		Msg("Loaded executions for session usage report")

	ctx.Set(ExecutionListKey, executions)
	return nil
}

// ============================================================================
// Step 3: Build report
// ============================================================================

type buildSessionUsageReportStep struct{}

func newBuildSessionUsageReportStep() *buildSessionUsageReportStep {
	return &buildSessionUsageReportStep{}
}

func (s *buildSessionUsageReportStep) Name() string { return "BuildSessionUsageReport" }

func (s *buildSessionUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetSessionUsageReportInput]) error {
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	sessionID := ctx.Input().GetSessionId()

	sortExecutionsByStartedAt(executions)

	summaries := make([]*agentexecutionv1.ExecutionUsageSummary, 0, len(executions))
	for _, exec := range executions {
		summaries = append(summaries, buildExecutionSummary(exec))
	}

	report := &agentexecutionv1.GetSessionUsageReportOutput{
		SessionId:        sessionID,
		ExecutionCount:   int32(len(executions)),
		TotalUsage:       aggregateUsageReport(executions),
		Executions:       summaries,
		ModelBreakdown:   mergeModelBreakdowns(executions),
		FirstExecutionAt: earliestStartedAt(executions),
		LastExecutionAt:  latestStartedAt(executions),
	}

	ctx.Set(sessionUsageReportKey, report)
	return nil
}

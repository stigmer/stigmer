package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const agentUsageReportKey = "agent_usage_report"

// GetAgentUsageReport returns aggregated usage metrics for all executions
// of an agent within an optional date range. Provides agent-level totals
// and per-session breakdown.
//
// Pipeline:
// 1. Validate   -- Ensure agent_id is provided
// 2. Load       -- Load all executions for the agent, filter by date range
// 3. Aggregate  -- Compute totals, per-session summaries, model breakdown
// 4. Respond    -- Build the GetAgentUsageReportOutput
func (c *AgentExecutionController) GetAgentUsageReport(ctx context.Context, req *agentexecutionv1.GetAgentUsageReportInput) (*agentexecutionv1.GetAgentUsageReportOutput, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetAgentUsageReportPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(agentUsageReportKey).(*agentexecutionv1.GetAgentUsageReportOutput)
	if !ok {
		return nil, grpclib.InternalError(nil, "agent usage report not found in context")
	}
	return result, nil
}

func (c *AgentExecutionController) buildGetAgentUsageReportPipeline() *pipeline.Pipeline[*agentexecutionv1.GetAgentUsageReportInput] {
	return pipeline.NewPipeline[*agentexecutionv1.GetAgentUsageReportInput]("get-agent-usage-report").
		AddStep(newValidateAgentUsageReportStep()).
		AddStep(newLoadAgentExecutionsStep(c.store)).
		AddStep(newBuildAgentUsageReportStep(c.store)).
		Build()
}

// ============================================================================
// Step 1: Validate
// ============================================================================

type validateAgentUsageReportStep struct{}

func newValidateAgentUsageReportStep() *validateAgentUsageReportStep {
	return &validateAgentUsageReportStep{}
}

func (s *validateAgentUsageReportStep) Name() string { return "ValidateAgentUsageReport" }

func (s *validateAgentUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetAgentUsageReportInput]) error {
	if ctx.Input().GetAgentId() == "" {
		return grpclib.InvalidArgumentError("agent_id is required")
	}
	return nil
}

// ============================================================================
// Step 2: Load executions by agent, apply date range filter
// ============================================================================

type loadAgentExecutionsStep struct {
	store store.Store
}

func newLoadAgentExecutionsStep(s store.Store) *loadAgentExecutionsStep {
	return &loadAgentExecutionsStep{store: s}
}

func (s *loadAgentExecutionsStep) Name() string { return "LoadAgentExecutions" }

func (s *loadAgentExecutionsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetAgentUsageReportInput]) error {
	req := ctx.Input()
	agentID := req.GetAgentId()

	data, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent executions")
	}

	all := make([]*agentexecutionv1.AgentExecution, 0)
	for _, d := range data {
		exec := &agentexecutionv1.AgentExecution{}
		if err := proto.Unmarshal(d, exec); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal execution, skipping")
			continue
		}
		all = append(all, exec)
	}

	filtered := filterByAgentID(all, agentID)
	filtered = filterByDateRange(filtered, req.GetFromDate(), req.GetToDate())

	log.Debug().
		Str("agent_id", agentID).
		Int("count", len(filtered)).
		Msg("Loaded executions for agent usage report")

	ctx.Set(ExecutionListKey, filtered)
	return nil
}

// ============================================================================
// Step 3: Build report
// ============================================================================

type buildAgentUsageReportStep struct {
	store store.Store
}

func newBuildAgentUsageReportStep(s store.Store) *buildAgentUsageReportStep {
	return &buildAgentUsageReportStep{store: s}
}

func (s *buildAgentUsageReportStep) Name() string { return "BuildAgentUsageReport" }

func (s *buildAgentUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetAgentUsageReportInput]) error {
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	agentID := ctx.Input().GetAgentId()
	agentName := s.resolveAgentName(ctx.Context(), agentID)

	sortExecutionsByStartedAt(executions)

	bySession := groupBySessionID(executions)
	sessionSummaries := make([]*agentexecutionv1.SessionUsageSummary, 0, len(bySession))
	for sid, group := range bySession {
		sessionSummaries = append(sessionSummaries, buildSessionSummary(sid, group))
	}

	report := &agentexecutionv1.GetAgentUsageReportOutput{
		AgentId:         agentID,
		AgentName:       agentName,
		TotalUsage:      aggregateUsageReport(executions),
		ModelBreakdown:  mergeModelBreakdowns(executions),
		Sessions:        sessionSummaries,
		TotalSessions:   int32(len(bySession)),
		TotalExecutions: int32(len(executions)),
	}

	ctx.Set(agentUsageReportKey, report)
	return nil
}

func (s *buildAgentUsageReportStep) resolveAgentName(ctx context.Context, agentID string) string {
	agent := &agentv1.Agent{}
	if err := s.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agentID, agent); err != nil {
		log.Debug().Str("agent_id", agentID).Err(err).Msg("Could not resolve agent name, using ID")
		return agentID
	}
	if name := agent.GetMetadata().GetName(); name != "" {
		return name
	}
	return agentID
}

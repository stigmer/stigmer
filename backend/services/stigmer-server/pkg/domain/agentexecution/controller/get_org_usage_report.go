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

const orgUsageReportKey = "org_usage_report"

// GetOrgUsageReport returns aggregated usage metrics for an entire
// organization within a required date range. Provides org-level totals,
// per-model breakdown, top agents by cost, and daily cost trend.
//
// Pipeline:
// 1. Validate   -- Ensure org_id, from_date, to_date are provided
// 2. Load       -- Load all executions for the org in the date range
// 3. Aggregate  -- Compute totals, top agents, daily trend
// 4. Respond    -- Build the GetOrgUsageReportOutput
func (c *AgentExecutionController) GetOrgUsageReport(ctx context.Context, req *agentexecutionv1.GetOrgUsageReportInput) (*agentexecutionv1.GetOrgUsageReportOutput, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetOrgUsageReportPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(orgUsageReportKey).(*agentexecutionv1.GetOrgUsageReportOutput)
	if !ok {
		return nil, grpclib.InternalError(nil, "org usage report not found in context")
	}
	return result, nil
}

func (c *AgentExecutionController) buildGetOrgUsageReportPipeline() *pipeline.Pipeline[*agentexecutionv1.GetOrgUsageReportInput] {
	return pipeline.NewPipeline[*agentexecutionv1.GetOrgUsageReportInput]("get-org-usage-report").
		AddStep(newValidateOrgUsageReportStep()).
		AddStep(newLoadOrgExecutionsStep(c.store)).
		AddStep(newBuildOrgUsageReportStep(c.store)).
		Build()
}

// ============================================================================
// Step 1: Validate
// ============================================================================

type validateOrgUsageReportStep struct{}

func newValidateOrgUsageReportStep() *validateOrgUsageReportStep {
	return &validateOrgUsageReportStep{}
}

func (s *validateOrgUsageReportStep) Name() string { return "ValidateOrgUsageReport" }

func (s *validateOrgUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetOrgUsageReportInput]) error {
	req := ctx.Input()
	if req.GetOrgId() == "" {
		return grpclib.InvalidArgumentError("org_id is required")
	}
	if req.GetFromDate() == "" {
		return grpclib.InvalidArgumentError("from_date is required")
	}
	if req.GetToDate() == "" {
		return grpclib.InvalidArgumentError("to_date is required")
	}
	return nil
}

// ============================================================================
// Step 2: Load executions by org + date range
// ============================================================================

type loadOrgExecutionsStep struct {
	store store.Store
}

func newLoadOrgExecutionsStep(s store.Store) *loadOrgExecutionsStep {
	return &loadOrgExecutionsStep{store: s}
}

func (s *loadOrgExecutionsStep) Name() string { return "LoadOrgExecutions" }

func (s *loadOrgExecutionsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetOrgUsageReportInput]) error {
	req := ctx.Input()

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

	filtered := filterByOrg(all, req.GetOrgId())
	filtered = filterByDateRange(filtered, req.GetFromDate(), req.GetToDate())

	log.Debug().
		Str("org_id", req.GetOrgId()).
		Int("count", len(filtered)).
		Msg("Loaded executions for org usage report")

	ctx.Set(ExecutionListKey, filtered)
	return nil
}

// ============================================================================
// Step 3: Build report
// ============================================================================

const topAgentsLimit = 10

type buildOrgUsageReportStep struct {
	store store.Store
}

func newBuildOrgUsageReportStep(s store.Store) *buildOrgUsageReportStep {
	return &buildOrgUsageReportStep{store: s}
}

func (s *buildOrgUsageReportStep) Name() string { return "BuildOrgUsageReport" }

func (s *buildOrgUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetOrgUsageReportInput]) error {
	executions, ok := ctx.Get(ExecutionListKey).([]*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution list not found in context")
	}

	orgID := ctx.Input().GetOrgId()

	byAgent := groupByAgentID(executions)
	agentSummaries := make([]*agentexecutionv1.AgentUsageSummary, 0, len(byAgent))
	for aid, group := range byAgent {
		name := s.resolveAgentName(ctx.Context(), aid)
		agentSummaries = append(agentSummaries, buildAgentSummary(aid, name, group))
	}

	report := &agentexecutionv1.GetOrgUsageReportOutput{
		OrgId:           orgID,
		TotalAgents:     int32(len(distinctAgentIDs(executions))),
		TotalSessions:   int32(len(distinctSessionIDs(executions))),
		TotalExecutions: int32(len(executions)),
		ModelBreakdown:  mergeModelBreakdowns(executions),
		TopAgentsByCost: topAgentsByCost(agentSummaries, topAgentsLimit),
		DailyCosts:      buildDailyCostEntries(executions),
	}

	ctx.Set(orgUsageReportKey, report)
	return nil
}

func (s *buildOrgUsageReportStep) resolveAgentName(ctx context.Context, agentID string) string {
	if agentID == "" {
		return "(unknown agent)"
	}
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

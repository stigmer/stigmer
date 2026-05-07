package agentexecution

import (
	"context"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const executionUsageReportKey = "execution_usage_report"

// GetExecutionUsageReport returns a usage report for a single execution.
//
// In OSS mode, per-call usage data is not available (it lives in the cloud
// billing domain's llm_call_usage_record collection). The handler verifies
// the execution exists and returns a structurally valid response with zero
// token counts and zero cost.
//
// Pipeline:
// 1. Validate   -- Ensure execution_id is provided
// 2. Load       -- Load the execution from store (verifies existence)
// 3. Build      -- Construct the response (zero aggregate in OSS)
func (c *AgentExecutionController) GetExecutionUsageReport(ctx context.Context, req *agentexecutionv1.GetExecutionUsageReportInput) (*agentexecutionv1.GetExecutionUsageReportOutput, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetExecutionUsageReportPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(executionUsageReportKey).(*agentexecutionv1.GetExecutionUsageReportOutput)
	if !ok {
		return nil, grpclib.InternalError(nil, "execution usage report not found in context")
	}
	return result, nil
}

func (c *AgentExecutionController) buildGetExecutionUsageReportPipeline() *pipeline.Pipeline[*agentexecutionv1.GetExecutionUsageReportInput] {
	return pipeline.NewPipeline[*agentexecutionv1.GetExecutionUsageReportInput]("get-execution-usage-report").
		AddStep(newValidateExecutionUsageReportStep()).
		AddStep(newLoadExecutionStep(c.store)).
		AddStep(newBuildExecutionUsageReportStep()).
		Build()
}

// ============================================================================
// Step 1: Validate
// ============================================================================

type validateExecutionUsageReportStep struct{}

func newValidateExecutionUsageReportStep() *validateExecutionUsageReportStep {
	return &validateExecutionUsageReportStep{}
}

func (s *validateExecutionUsageReportStep) Name() string { return "ValidateExecutionUsageReport" }

func (s *validateExecutionUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetExecutionUsageReportInput]) error {
	if ctx.Input().GetExecutionId() == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}
	return nil
}

// ============================================================================
// Step 2: Load execution (verifies existence)
// ============================================================================

const executionKey = "execution"

type loadExecutionStep struct {
	store store.Store
}

func newLoadExecutionStep(s store.Store) *loadExecutionStep {
	return &loadExecutionStep{store: s}
}

func (s *loadExecutionStep) Name() string { return "LoadExecution" }

func (s *loadExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetExecutionUsageReportInput]) error {
	executionID := ctx.Input().GetExecutionId()

	exec := &agentexecutionv1.AgentExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, exec); err != nil {
		return grpclib.NotFoundError("agent execution '%s' not found", executionID)
	}

	ctx.Set(executionKey, exec)
	return nil
}

// ============================================================================
// Step 3: Build report
// ============================================================================

type buildExecutionUsageReportStep struct{}

func newBuildExecutionUsageReportStep() *buildExecutionUsageReportStep {
	return &buildExecutionUsageReportStep{}
}

func (s *buildExecutionUsageReportStep) Name() string { return "BuildExecutionUsageReport" }

func (s *buildExecutionUsageReportStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.GetExecutionUsageReportInput]) error {
	report := &agentexecutionv1.GetExecutionUsageReportOutput{
		Aggregate: &agentexecutionv1.UsageReportAggregate{},
	}

	ctx.Set(executionUsageReportKey, report)
	return nil
}

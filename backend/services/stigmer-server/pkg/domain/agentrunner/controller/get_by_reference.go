package agentrunner

import (
	"context"

	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves an AgentRunner by its organization-scoped reference (org + slug).
//
// Used by the CLI to resolve a runner by name:
//
//	stigmer run agent my-agent --runner my-macbook
//
// resolves "my-macbook" to the full AgentRunner resource.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (ApiResourceReference)
//  2. LoadByReference — find runner by slug (with optional org filter)
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Custom FGA authorization (no IAM in OSS)
func (c *AgentRunnerController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentrunnerv1.AgentRunner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*agentrunnerv1.AgentRunner), nil
}

func (c *AgentRunnerController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-runner-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).   // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*agentrunnerv1.AgentRunner](c.store)). // 2. Load by slug
		Build()
}

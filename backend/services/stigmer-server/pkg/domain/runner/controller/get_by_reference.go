package runner

import (
	"context"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves a Runner by its organization-scoped reference (org + slug).
//
// Used by the CLI to resolve a runner by name:
//
//	stigmer run agent my-agent --runner my-macbook
//
// resolves "my-macbook" to the full Runner resource.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (ApiResourceReference)
//  2. LoadByReference — find runner by slug (with optional org filter)
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Custom FGA authorization (no IAM in OSS)
func (c *RunnerController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*runnerv1.Runner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*runnerv1.Runner), nil
}

func (c *RunnerController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("runner-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()). // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*runnerv1.Runner](c.store)).         // 2. Load by slug
		Build()
}

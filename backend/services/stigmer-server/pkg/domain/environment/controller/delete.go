package environment

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Delete deletes an environment by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (ApiResourceDeleteInput)
// 2. LoadExistingForDelete - Load environment from database (stores in context)
// 3. DeleteResource - Delete environment from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted environment is returned for audit trail purposes (gRPC convention).
func (c *EnvironmentController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*environmentv1.Environment, error) {
	// Create request context with the delete input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Manually extract and store resource ID since ApiResourceDeleteInput uses
	// ResourceId field instead of Value field (which ExtractResourceIdStep expects)
	reqCtx.Set(steps.ResourceIdKey, input.ResourceId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted environment from context (set by LoadExistingForDelete step before deletion)
	deletedEnvironment := reqCtx.Get(steps.ExistingResourceKey)
	if deletedEnvironment == nil {
		return nil, grpclib.InternalError(nil, "deleted environment not found in context")
	}

	return deletedEnvironment.(*environmentv1.Environment), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// Note: ExtractResourceIdStep is NOT used here because ApiResourceDeleteInput
// has ResourceId field (not Value), so we manually extract it in Delete method
func (c *EnvironmentController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("environment-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                        // 1. Validate field constraints
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *environmentv1.Environment](c.store)). // 2. Load environment
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                                // 3. Delete from database
		Build()
}

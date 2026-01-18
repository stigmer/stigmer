package environment

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	environmentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Delete deletes an environment by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (environment ID wrapper)
// 2. ExtractResourceId - Extract ID from ApiResourceDeleteInput wrapper
// 3. LoadExistingForDelete - Load environment from database (stores in context)
// 4. DeleteResource - Delete environment from database
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
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *EnvironmentController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("environment-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                        // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*apiresource.ApiResourceDeleteInput]()).                                    // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *environmentv1.Environment](c.store)). // 3. Load environment
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                                // 4. Delete from database
		Build()
}

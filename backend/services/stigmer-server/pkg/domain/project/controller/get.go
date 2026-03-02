package project

import (
	"context"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a project by ID using the pipeline framework.
//
// This implements the standard Get operation pattern:
//  1. ValidateProto - Validate input ProjectId (ensures value is not empty)
//  2. LoadTarget - Load project from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
//   - ValidateProto: Validates buf.validate constraints on ProjectId
//   - LoadTarget: Loads project from SQLite by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - ExtractResourceId step (not needed - ID is already in ProjectId.value)
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
//   - SendResponse step (handler returns directly)
//
// The loaded project is stored in context with key "targetResource" and
// returned by the handler.
func (c *ProjectController) Get(ctx context.Context, projectId *projectv1.ProjectId) (*projectv1.Project, error) {
	reqCtx := pipeline.NewRequestContext(ctx, projectId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded project from context
	project := reqCtx.Get(steps.TargetResourceKey).(*projectv1.Project)
	return project, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations.
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
//
// Pipeline steps:
//  1. ValidateProtoStep - Validates buf.validate constraints on input
//  2. LoadTargetStep - Loads project from store by ID
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *ProjectController) buildGetPipeline() *pipeline.Pipeline[*projectv1.ProjectId] {
	return pipeline.NewPipeline[*projectv1.ProjectId]("project-get").
		AddStep(steps.NewValidateProtoStep[*projectv1.ProjectId]()).                         // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*projectv1.ProjectId, *projectv1.Project](c.store)). // 2. Load by ID
		Build()
}

package project

import (
	"context"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing project using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validates proto field constraints using buf.validate
//  2. ResolveSlug - Generates slug from metadata.name
//  3. LoadExisting - Loads existing project from repository by ID or slug
//  4. BuildUpdateState - Merges spec, preserves IDs, updates timestamps
//  5. Persist - Saves updated project to repository
//
// Key Behaviors:
//   - LoadExistingStep attempts lookup by ID first, then falls back to slug
//   - BuildUpdateStateStep preserves immutable fields: metadata.id, metadata.slug, metadata.org
//   - Status is system-managed: cleared from input, preserved from existing
//   - Audit fields: preserves created_by/created_at, updates updated_by/updated_at
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *ProjectController) Update(ctx context.Context, project *projectv1.Project) (*projectv1.Project, error) {
	reqCtx := pipeline.NewRequestContext(ctx, project)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for project update.
//
// The pipeline uses standard steps from the pipeline framework:
//  1. ValidateProtoStep - Validates buf.validate constraints
//  2. ResolveSlugStep - Generates slug from metadata.name
//  3. LoadExistingStep - Loads by ID (preferred) or slug (fallback)
//  4. BuildUpdateStateStep - Merges spec while preserving immutable fields
//  5. PersistStep - Saves to repository
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *ProjectController) buildUpdatePipeline() *pipeline.Pipeline[*projectv1.Project] {
	return pipeline.NewPipeline[*projectv1.Project]("project-update").
		AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*projectv1.Project](c.store)). // 3. Load existing project
		AddStep(steps.NewBuildUpdateStateStep[*projectv1.Project]()).    // 4. Build updated state
		AddStep(steps.NewPersistStep[*projectv1.Project](c.store)).      // 5. Persist project
		Build()
}

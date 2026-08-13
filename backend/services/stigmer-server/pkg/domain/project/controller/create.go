package project

import (
	"context"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new project using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validates proto field constraints using buf.validate
//     (api_version, kind, metadata required)
//  2. ResolveSlug - Generates URL-safe slug from metadata.name
//  3. CheckDuplicate - Verifies no duplicate exists by slug within org
//  4. BuildNewState - Generates ID (prj-{ulid}), clears status, sets audit fields, defaults visibility
//  5. Persist - Saves project to repository
//
// Unlike Agent, Project has no custom steps (no default instance creation).
// This keeps the implementation clean and focused on the core CRUD operation.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *ProjectController) Create(ctx context.Context, project *projectv1.Project) (*projectv1.Project, error) {
	reqCtx := pipeline.NewRequestContext(ctx, project)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for project creation.
//
// The pipeline uses standard steps from the pipeline framework:
//  1. ValidateProtoStep - Validates buf.validate constraints
//  2. ResolveSlugStep - Generates slug from metadata.name
//  3. CheckDuplicateStep - Prevents duplicate slugs within org
//  4. BuildNewStateStep - Generates ID, clears status, sets audit
//  5. PersistStep - Saves to repository
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *ProjectController) buildCreatePipeline() *pipeline.Pipeline[*projectv1.Project] {
	return pipeline.NewPipeline[*projectv1.Project]("project-create").
		AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).                                     // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*projectv1.Project]()).                                // Reject unsupported visibility levels (fail fast)
		AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).                                       // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*projectv1.Project](c.store)).                             // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*projectv1.Project]()).                                     // 4. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*projectv1.Project]()).                               // 5. Normalize cross-references
		AddStep(steps.NewPersistStep[*projectv1.Project](c.store)).                                    // 6. Persist project
		AddStep(steps.NewIndexSearchStep[*projectv1.Project](c.store, &extractor.ProjectExtractor{})). // 7. Update search index
		Build()
}

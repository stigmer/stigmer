package project

import (
	"context"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a project by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (project ID wrapper)
//  2. ExtractResourceId - Extract ID from ProjectId.Value wrapper
//  3. LoadExistingForDelete - Load project from database (stores in context)
//  4. DeleteResource - Delete project from database
//
// Cascade Behavior:
// This handler deletes ONLY the Project entity itself. Resources owned by
// the project (tagged with "stigmer.ai/sdk.project" annotation) are NOT
// automatically deleted. Cascade deletion may be added in future phases
// via the reconciliation engine.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-tenant auth in OSS)
//   - IAM policy cleanup step (no IAM/FGA in OSS)
//   - Event publishing step (no event publishing in OSS)
func (c *ProjectController) Delete(ctx context.Context, projectId *projectv1.ProjectId) (*projectv1.Project, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, projectId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted project from context (set by LoadExistingForDelete step before deletion)
	deletedProject := reqCtx.Get(steps.ExistingResourceKey)
	if deletedProject == nil {
		return nil, grpclib.InternalError(nil, "deleted project not found in context")
	}

	return deletedProject.(*projectv1.Project), nil
}

// buildDeletePipeline constructs the pipeline for delete operations.
//
// The pipeline uses standard steps from the pipeline framework:
//  1. ValidateProtoStep - Validates buf.validate constraints on ProjectId
//  2. ExtractResourceIdStep - Extracts ID string from ProjectId.Value
//  3. LoadExistingForDeleteStep - Loads project before deletion (for return value)
//  4. DeleteResourceStep - Performs the actual deletion from database
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *ProjectController) buildDeletePipeline() *pipeline.Pipeline[*projectv1.ProjectId] {
	return pipeline.NewPipeline[*projectv1.ProjectId]("project-delete").
		AddStep(steps.NewValidateProtoStep[*projectv1.ProjectId]()).                                    // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*projectv1.ProjectId]()).                                // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*projectv1.ProjectId, *projectv1.Project](c.store)). // 3. Load project
		AddStep(steps.NewDeleteResourceStep[*projectv1.ProjectId](c.store)).                            // 4. Delete from database
		Build()
}

package project

import (
	"context"

	"github.com/rs/zerolog/log"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
)

// Apply creates or updates a project and reconciles its membership.
//
// This implements declarative "apply" semantics:
//  1. Checks if project exists by slug
//  2. Captures previous membership list (for orphan detection)
//  3. If exists -> delegates to Update()
//  4. If not exists -> delegates to Create()
//  5. Reconciles membership: compares previous vs current members
//  6. Optionally prunes orphaned resources
//  7. Returns project with ReconciliationSummary in status.last_reconciliation
//
// The reconciliation process compares the previous project's spec.members with
// the newly persisted project's spec.members. Resources in the previous list
// but not in the current list are orphans and may be deleted.
func (c *ProjectController) Apply(ctx context.Context, project *projectv1.Project) (*projectv1.Project, error) {
	reqCtx := pipeline.NewRequestContext(ctx, project)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	// Capture previous members before Create/Update overwrites the project.
	// On first apply (create), there are no previous members.
	var previousMembers []*apiresource.ApiResourceReference
	if !shouldCreate {
		previousMembers = extractPreviousMembers(reqCtx)
	}

	var persistedProject *projectv1.Project
	var err error

	if shouldCreate {
		log.Info().
			Str("name", project.GetMetadata().GetName()).
			Msg("Project does not exist - delegating to CREATE")
		persistedProject, err = c.Create(ctx, project)
	} else {
		log.Info().
			Str("name", project.GetMetadata().GetName()).
			Str("id", project.GetMetadata().GetId()).
			Msg("Project exists - delegating to UPDATE")
		persistedProject, err = c.Update(ctx, project)
	}

	if err != nil {
		return nil, err
	}

	currentMembers := persistedProject.GetSpec().GetMembers()

	result, err := c.reconciliationService.Reconcile(
		ctx, previousMembers, currentMembers, reconcile.DefaultOptions(),
	)
	if err != nil {
		log.Error().Err(err).
			Str("projectId", persistedProject.GetMetadata().GetId()).
			Msg("Reconciliation failed")
		return persistedProject, nil
	}

	return c.buildApplyResponse(persistedProject, result), nil
}

// buildApplyPipeline constructs the minimal pipeline for apply operations.
//
// This pipeline only determines whether to create or update.
// The actual create/update is delegated to the respective handlers.
func (c *ProjectController) buildApplyPipeline() *pipeline.Pipeline[*projectv1.Project] {
	return pipeline.NewPipeline[*projectv1.Project]("project-apply").
		AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*projectv1.Project](c.store)). // 3. Check existence
		Build()
}

// extractPreviousMembers retrieves the existing project's members from the
// pipeline context. LoadForApplyStep stores the existing resource under
// ExistingResourceKey when the project already exists.
func extractPreviousMembers(reqCtx *pipeline.RequestContext[*projectv1.Project]) []*apiresource.ApiResourceReference {
	existingVal := reqCtx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return nil
	}

	existingProject, ok := existingVal.(*projectv1.Project)
	if !ok {
		return nil
	}

	return existingProject.GetSpec().GetMembers()
}

// buildApplyResponse constructs the response by setting the reconciliation summary.
//
// The ReconciliationSummary is populated in status.last_reconciliation.
// This is NOT persisted to the database — it exists only in the response.
func (c *ProjectController) buildApplyResponse(
	project *projectv1.Project,
	result *reconcile.ReconciliationResult,
) *projectv1.Project {
	if result == nil {
		return project
	}

	if project.Status == nil {
		project.Status = &projectv1.ProjectStatus{}
	}

	project.Status.LastReconciliation = result.ToProtoSummary()

	return project
}

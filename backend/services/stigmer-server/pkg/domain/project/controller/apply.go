package project

import (
	"context"

	"github.com/rs/zerolog/log"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
)

// Apply creates or updates a project and reconciles its embedded resources.
//
// This implements declarative "apply" semantics (similar to kubectl apply):
//  1. Checks if project exists by slug
//  2. If exists → delegates to Update()
//  3. If not exists → delegates to Create()
//  4. Calls ReconciliationService to sync embedded resources
//  5. Returns project with ReconciliationSummary in status.last_reconciliation
//
// The reconciliation process:
//   - Parses desired state from project.spec (agents, workflows, mcp_servers, skills)
//   - Fetches actual state from database (resources owned by this project)
//   - Computes diff and executes creates/updates/deletes in dependency order
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadForApply - Attempt to load existing (doesn't fail if not found)
//  4. Delegate decision based on context flags
//  5. Run reconciliation on persisted project
//
// The heavy lifting (validation, persistence, etc.) is handled by
// the delegated Create or Update handlers.
func (c *ProjectController) Apply(ctx context.Context, project *projectv1.Project) (*projectv1.Project, error) {
	reqCtx := pipeline.NewRequestContext(ctx, project)

	// Build and execute minimal apply pipeline
	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Check shouldCreate flag set by LoadForApplyStep
	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	// Delegate to appropriate handler for project persistence
	var persistedProject *projectv1.Project
	var err error

	if shouldCreate {
		log.Info().
			Str("slug", project.GetMetadata().GetName()).
			Msg("Project does not exist - delegating to CREATE")
		persistedProject, err = c.Create(ctx, project)
	} else {
		log.Info().
			Str("slug", project.GetMetadata().GetName()).
			Str("id", project.GetMetadata().GetId()).
			Msg("Project exists - delegating to UPDATE")
		persistedProject, err = c.Update(ctx, project)
	}

	if err != nil {
		return nil, err
	}

	// Run reconciliation on the persisted project
	result, err := c.reconcile(ctx, persistedProject)
	if err != nil {
		// Log error but don't fail the apply - project was persisted successfully
		log.Error().Err(err).
			Str("projectId", persistedProject.GetMetadata().GetId()).
			Msg("Reconciliation failed")
		// Return project without reconciliation summary
		return persistedProject, nil
	}

	// Set reconciliation summary in status
	return c.buildApplyResponse(persistedProject, result), nil
}

// buildApplyPipeline constructs the minimal pipeline for apply operations.
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *ProjectController) buildApplyPipeline() *pipeline.Pipeline[*projectv1.Project] {
	return pipeline.NewPipeline[*projectv1.Project]("project-apply").
		AddStep(steps.NewValidateProtoStep[*projectv1.Project]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*projectv1.Project]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*projectv1.Project](c.store)). // 3. Check existence
		Build()
}

// reconcile runs the reconciliation service on the project.
//
// This method wraps the reconciliation service call and handles options.
// By default, it uses DefaultOptions (prune enabled, not dry-run).
func (c *ProjectController) reconcile(
	ctx context.Context,
	project *projectv1.Project,
) (*reconcile.ReconciliationResult, error) {
	return c.reconciliationService.Reconcile(ctx, project, reconcile.DefaultOptions())
}

// buildApplyResponse constructs the response by setting the reconciliation summary.
//
// The ReconciliationSummary is populated in status.last_reconciliation.
// Note: This is NOT persisted to the database - it's only in the response.
func (c *ProjectController) buildApplyResponse(
	project *projectv1.Project,
	result *reconcile.ReconciliationResult,
) *projectv1.Project {
	if result == nil {
		return project
	}

	// Ensure status exists
	if project.Status == nil {
		project.Status = &projectv1.ProjectStatus{}
	}

	// Set the reconciliation summary
	project.Status.LastReconciliation = result.ToProtoSummary()

	return project
}

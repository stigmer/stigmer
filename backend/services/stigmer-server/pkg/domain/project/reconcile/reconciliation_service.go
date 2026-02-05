// Package reconcile provides the reconciliation engine for Project resources.
//
// The reconciliation engine compares desired state (from Project.Spec) with
// actual state (from repositories) to determine what resources need to be
// created, updated, or deleted to achieve convergence.
package reconcile

import (
	"context"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
)

// ReconciliationService orchestrates the reconciliation process for Project resources.
//
// ReconciliationService is the main entry point for reconciliation. It coordinates:
//  1. Parsing desired state from Project.Spec (embedded agents, workflows, etc.)
//  2. Fetching actual state from repositories (resources owned by the project)
//  3. Building the dependency graph
//  4. Computing the diff (what to create, update, delete)
//  5. Executing the reconciliation plan (or returning it for dry-run)
//
// The interface enables dependency injection for testing and allows evolution
// of the implementation without changing consumers (like the Apply handler).
//
// Example:
//
//	service := NewReconciliationService(store)
//	result, err := service.Reconcile(ctx, project, DefaultOptions())
//	if err != nil {
//	    return err
//	}
//	// Use result.ToProtoSummary() for API response
type ReconciliationService interface {
	// Reconcile executes the reconciliation process for a project.
	//
	// The method:
	//  1. Parses desired state from project.Spec (embedded resources)
	//  2. Fetches actual state from repositories (resources owned by project)
	//  3. Builds the dependency graph for topological ordering
	//  4. Computes the diff to determine creates, updates, deletes
	//  5. Executes the plan (unless dry-run mode)
	//
	// Parameters:
	//   - ctx: Context for cancellation and deadline propagation
	//   - project: The Project with desired state in its Spec field
	//   - options: Reconciliation options (dry-run, prune behavior)
	//
	// Returns:
	//   - ReconciliationResult: Summary of what was created, updated, deleted
	//   - error: If reconciliation fails completely (partial failures are in result)
	//
	// Note: The project must have metadata.id populated (persisted to database).
	// The project ID is used to fetch owned resources and set ownership annotations.
	Reconcile(ctx context.Context, project *projectv1.Project, options *ReconciliationOptions) (*ReconciliationResult, error)
}

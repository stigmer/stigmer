// Package reconcile provides membership reconciliation for Project resources.
//
// The reconciliation engine compares two membership lists — the previous set of
// ApiResourceReference members and the current set — to determine which members
// were added to the project and which are orphans to be pruned.
//
// In the reference-based model, resources are applied individually by the CLI
// before the project is updated. The server's reconciliation responsibility is
// limited to membership tracking and orphan cleanup.
package reconcile

import (
	"context"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// ReconciliationService orchestrates membership reconciliation for Project resources.
//
// Given the previous and current member lists, it computes:
//   - Added members: references in current but not in previous
//   - Orphaned members: references in previous but not in current
//
// When pruning is enabled, orphaned resources are deleted via the ResourceDeleter.
// The service supports dry-run mode (compute changes without executing) and
// partial failure handling (continue deleting other orphans if one fails).
//
// The interface enables dependency injection for testing and allows evolution
// of the implementation without changing consumers.
type ReconciliationService interface {
	// Reconcile compares previous and current membership lists and optionally
	// prunes orphaned resources.
	//
	// Parameters:
	//   - ctx: Context for cancellation and deadline propagation
	//   - previousMembers: Members from the previously persisted project (nil for first apply)
	//   - currentMembers: Members from the newly applied project
	//   - options: Controls prune and dry-run behavior
	//
	// Returns:
	//   - ReconciliationResult: Added members, removed (pruned) members, and errors
	//   - error: Only for fatal failures; partial deletion failures are in the result
	Reconcile(
		ctx context.Context,
		previousMembers []*apiresource.ApiResourceReference,
		currentMembers []*apiresource.ApiResourceReference,
		options *ReconciliationOptions,
	) (*ReconciliationResult, error)
}

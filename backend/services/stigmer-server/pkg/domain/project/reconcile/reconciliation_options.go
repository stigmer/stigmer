package reconcile

// Singleton option instances for common configurations.
// These are shared to avoid allocations for common use cases.
var (
	defaultOptions = &ReconciliationOptions{
		pruneEnabled: true,
		dryRun:       false,
	}
	dryRunOptions = &ReconciliationOptions{
		pruneEnabled: true,
		dryRun:       true,
	}
	noPruneOptions = &ReconciliationOptions{
		pruneEnabled: false,
		dryRun:       false,
	}
)

// ReconciliationOptions controls the behavior of the reconciliation process.
//
// ReconciliationOptions is an immutable configuration object that determines
// how reconciliation executes:
//   - pruneEnabled: When true, delete orphan resources (resources in actual state
//     but not in desired state). Default: true.
//   - dryRun: When true, compute the plan but don't execute changes. Default: false.
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - Copy methods create new instances
//   - There are no setters
//
// Example:
//
//	// Use defaults (prune orphans, execute changes)
//	opts := DefaultOptions()
//
//	// Preview changes without executing
//	opts := DryRunOptions()
//
//	// Disable orphan pruning (safer for initial testing)
//	opts := NoPruneOptions()
//
//	// Custom: dry run without pruning
//	opts := NoPruneOptions().WithDryRun(true)
type ReconciliationOptions struct {
	pruneEnabled bool
	dryRun       bool
}

// DefaultOptions returns the default reconciliation options.
//
// Defaults:
//   - pruneEnabled: true (orphan resources are deleted)
//   - dryRun: false (changes are executed)
//
// This is the recommended configuration for production use.
func DefaultOptions() *ReconciliationOptions {
	return defaultOptions
}

// DryRunOptions returns options for a dry run (plan without execution).
//
// Configuration:
//   - pruneEnabled: true (orphans appear in plan)
//   - dryRun: true (no changes executed)
//
// Use this to preview what changes would be made without actually making them.
func DryRunOptions() *ReconciliationOptions {
	return dryRunOptions
}

// NoPruneOptions returns options with orphan pruning disabled.
//
// Configuration:
//   - pruneEnabled: false (orphans are NOT deleted)
//   - dryRun: false (changes are executed)
//
// Use this for safer initial testing or when orphan cleanup should be manual.
// WARNING: Disabling prune can lead to orphan resource accumulation.
func NoPruneOptions() *ReconciliationOptions {
	return noPruneOptions
}

// IsPruneEnabled returns true if orphan pruning is enabled.
//
// When true, resources that exist in actual state but not in desired state
// (orphans) will be deleted during reconciliation.
func (o *ReconciliationOptions) IsPruneEnabled() bool {
	return o.pruneEnabled
}

// IsDryRun returns true if this is a dry run.
//
// When true, the reconciliation plan is computed but no changes are executed.
func (o *ReconciliationOptions) IsDryRun() bool {
	return o.dryRun
}

// WithPrune returns a new ReconciliationOptions with the specified prune setting.
//
// This is a copy method - the original options are not modified.
//
// Example:
//
//	opts := DryRunOptions().WithPrune(false) // dry run without pruning
func (o *ReconciliationOptions) WithPrune(enabled bool) *ReconciliationOptions {
	// Return singleton if it matches
	if enabled == o.pruneEnabled {
		return o
	}
	return &ReconciliationOptions{
		pruneEnabled: enabled,
		dryRun:       o.dryRun,
	}
}

// WithDryRun returns a new ReconciliationOptions with the specified dry run setting.
//
// This is a copy method - the original options are not modified.
//
// Example:
//
//	opts := DefaultOptions().WithDryRun(true) // convert to dry run
func (o *ReconciliationOptions) WithDryRun(dryRun bool) *ReconciliationOptions {
	// Return singleton if it matches
	if dryRun == o.dryRun {
		return o
	}
	return &ReconciliationOptions{
		pruneEnabled: o.pruneEnabled,
		dryRun:       dryRun,
	}
}

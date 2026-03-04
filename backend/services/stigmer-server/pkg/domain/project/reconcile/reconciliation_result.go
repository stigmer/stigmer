package reconcile

import (
	"slices"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
)

var emptyResult = &ReconciliationResult{
	added:   []*apiresource.ApiResourceReference{},
	removed: []*apiresource.ApiResourceReference{},
	errors:  []ReconciliationError{},
}

// ReconciliationResult captures the outcome of a membership reconciliation.
//
// In the reference-based model, reconciliation compares two membership lists
// (previous vs current) and optionally deletes orphaned resources. The result
// tracks which members were added (new to the project), which were removed
// (orphans that were pruned), and any errors during orphan deletion.
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions or ResultBuilder
//   - Getters return defensive copies
type ReconciliationResult struct {
	added   []*apiresource.ApiResourceReference
	removed []*apiresource.ApiResourceReference
	errors  []ReconciliationError
}

// NewResult creates a ReconciliationResult with added and removed members.
func NewResult(
	added, removed []*apiresource.ApiResourceReference,
	errors []ReconciliationError,
) *ReconciliationResult {
	return &ReconciliationResult{
		added:   cloneRefSlice(added),
		removed: cloneRefSlice(removed),
		errors:  cloneErrorSlice(errors),
	}
}

// EmptyResult returns a singleton empty ReconciliationResult.
//
// Represents a reconciliation with no membership changes (previous == current).
func EmptyResult() *ReconciliationResult {
	return emptyResult
}

// Added returns a defensive copy of the newly added member references.
//
// These are references in the current membership list that were not in the
// previous list — resources newly associated with the project.
func (r *ReconciliationResult) Added() []*apiresource.ApiResourceReference {
	return slices.Clone(r.added)
}

// Removed returns a defensive copy of the removed (orphaned) member references.
//
// These are references that were in the previous membership list but not in
// the current list, and were successfully deleted during orphan pruning.
func (r *ReconciliationResult) Removed() []*apiresource.ApiResourceReference {
	return slices.Clone(r.removed)
}

// Errors returns a defensive copy of errors that occurred during reconciliation.
func (r *ReconciliationResult) Errors() []ReconciliationError {
	return slices.Clone(r.errors)
}

// IsSuccess returns true if no errors occurred during reconciliation.
func (r *ReconciliationResult) IsSuccess() bool {
	return len(r.errors) == 0
}

// HasErrors returns true if any errors occurred during reconciliation.
func (r *ReconciliationResult) HasErrors() bool {
	return len(r.errors) > 0
}

// AddedCount returns the number of members added to the project.
func (r *ReconciliationResult) AddedCount() int {
	return len(r.added)
}

// RemovedCount returns the number of orphaned members that were pruned.
func (r *ReconciliationResult) RemovedCount() int {
	return len(r.removed)
}

// ErrorCount returns the number of errors that occurred.
func (r *ReconciliationResult) ErrorCount() int {
	return len(r.errors)
}

// ToProtoSummary converts the result to a ReconciliationSummary proto message.
//
// Field mapping:
//   - added  -> created  (new members added to the project)
//   - (none) -> updated  (not applicable in reference model; always empty)
//   - removed -> deleted (orphans that were pruned)
func (r *ReconciliationResult) ToProtoSummary() *projectv1.ReconciliationSummary {
	return &projectv1.ReconciliationSummary{
		Created: slices.Clone(r.added),
		Updated: nil,
		Deleted: slices.Clone(r.removed),
	}
}

// ResultBuilder provides incremental construction of ReconciliationResult.
//
// Used during reconciliation execution to accumulate results as each
// orphan is processed.
type ResultBuilder struct {
	added   []*apiresource.ApiResourceReference
	removed []*apiresource.ApiResourceReference
	errors  []ReconciliationError
}

// NewResultBuilder creates a new ResultBuilder for incremental construction.
func NewResultBuilder() *ResultBuilder {
	return &ResultBuilder{
		added:   []*apiresource.ApiResourceReference{},
		removed: []*apiresource.ApiResourceReference{},
		errors:  []ReconciliationError{},
	}
}

// AddAdded records a member newly added to the project.
func (b *ResultBuilder) AddAdded(ref *apiresource.ApiResourceReference) *ResultBuilder {
	b.added = append(b.added, ref)
	return b
}

// AddRemoved records an orphan member that was successfully deleted.
func (b *ResultBuilder) AddRemoved(ref *apiresource.ApiResourceReference) *ResultBuilder {
	b.removed = append(b.removed, ref)
	return b
}

// AddError records a reconciliation error.
func (b *ResultBuilder) AddError(err ReconciliationError) *ResultBuilder {
	b.errors = append(b.errors, err)
	return b
}

// Build creates an immutable ReconciliationResult from the accumulated data.
func (b *ResultBuilder) Build() *ReconciliationResult {
	return &ReconciliationResult{
		added:   cloneRefSlice(b.added),
		removed: cloneRefSlice(b.removed),
		errors:  cloneErrorSlice(b.errors),
	}
}

func cloneRefSlice(s []*apiresource.ApiResourceReference) []*apiresource.ApiResourceReference {
	if s == nil {
		return []*apiresource.ApiResourceReference{}
	}
	return slices.Clone(s)
}

func cloneErrorSlice(s []ReconciliationError) []ReconciliationError {
	if s == nil {
		return []ReconciliationError{}
	}
	return slices.Clone(s)
}

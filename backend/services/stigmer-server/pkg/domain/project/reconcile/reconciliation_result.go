package reconcile

import (
	"slices"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
)

// emptyResult is a singleton empty ReconciliationResult for reuse.
var emptyResult = &ReconciliationResult{
	created: []*projectv1.ResourceChangeRecord{},
	updated: []*projectv1.ResourceChangeRecord{},
	deleted: []*projectv1.ResourceChangeRecord{},
	errors:  []ReconciliationError{},
}

// ReconciliationResult captures the outcome of a reconciliation execution.
//
// ReconciliationResult tracks which resources were successfully created, updated,
// or deleted, along with any errors that occurred during execution. It supports
// partial success - some resources may succeed while others fail.
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions or Builder
//   - Getters return defensive copies
//   - There are no setters
//
// Use ResultBuilder for incremental construction during execution.
//
// Example:
//
//	// Success case - all changes applied
//	result := NewSuccessResult(created, updated, deleted)
//
//	// Partial success - some failed
//	result := NewPartialResult(created, updated, deleted, errors)
//
//	// Convert to proto for API response
//	summary := result.ToProtoSummary()
type ReconciliationResult struct {
	created []*projectv1.ResourceChangeRecord
	updated []*projectv1.ResourceChangeRecord
	deleted []*projectv1.ResourceChangeRecord
	errors  []ReconciliationError
}

// NewSuccessResult creates a ReconciliationResult for a fully successful execution.
//
// Use this when all changes were applied without errors.
func NewSuccessResult(
	created, updated, deleted []*projectv1.ResourceChangeRecord,
) *ReconciliationResult {
	return &ReconciliationResult{
		created: cloneRecordSlice(created),
		updated: cloneRecordSlice(updated),
		deleted: cloneRecordSlice(deleted),
		errors:  []ReconciliationError{},
	}
}

// NewPartialResult creates a ReconciliationResult for partial success.
//
// Use this when some changes were applied but others failed.
// The errors slice should contain details about each failure.
func NewPartialResult(
	created, updated, deleted []*projectv1.ResourceChangeRecord,
	errors []ReconciliationError,
) *ReconciliationResult {
	return &ReconciliationResult{
		created: cloneRecordSlice(created),
		updated: cloneRecordSlice(updated),
		deleted: cloneRecordSlice(deleted),
		errors:  cloneErrorSlice(errors),
	}
}

// NewFailureResult creates a ReconciliationResult when execution completely failed.
//
// Use this when no changes could be applied at all.
func NewFailureResult(errors []ReconciliationError) *ReconciliationResult {
	return &ReconciliationResult{
		created: []*projectv1.ResourceChangeRecord{},
		updated: []*projectv1.ResourceChangeRecord{},
		deleted: []*projectv1.ResourceChangeRecord{},
		errors:  cloneErrorSlice(errors),
	}
}

// EmptyResult returns a singleton empty ReconciliationResult.
//
// This represents a successful execution with no changes (desired state
// already matches actual state).
func EmptyResult() *ReconciliationResult {
	return emptyResult
}

// Created returns a defensive copy of the created resource records.
func (r *ReconciliationResult) Created() []*projectv1.ResourceChangeRecord {
	return slices.Clone(r.created)
}

// Updated returns a defensive copy of the updated resource records.
func (r *ReconciliationResult) Updated() []*projectv1.ResourceChangeRecord {
	return slices.Clone(r.updated)
}

// Deleted returns a defensive copy of the deleted resource records.
func (r *ReconciliationResult) Deleted() []*projectv1.ResourceChangeRecord {
	return slices.Clone(r.deleted)
}

// Errors returns a defensive copy of the errors that occurred.
func (r *ReconciliationResult) Errors() []ReconciliationError {
	return slices.Clone(r.errors)
}

// IsSuccess returns true if no errors occurred during execution.
func (r *ReconciliationResult) IsSuccess() bool {
	return len(r.errors) == 0
}

// HasErrors returns true if any errors occurred during execution.
func (r *ReconciliationResult) HasErrors() bool {
	return len(r.errors) > 0
}

// TotalChanges returns the total number of successful changes.
func (r *ReconciliationResult) TotalChanges() int {
	return len(r.created) + len(r.updated) + len(r.deleted)
}

// CreatedCount returns the number of resources created.
func (r *ReconciliationResult) CreatedCount() int {
	return len(r.created)
}

// UpdatedCount returns the number of resources updated.
func (r *ReconciliationResult) UpdatedCount() int {
	return len(r.updated)
}

// DeletedCount returns the number of resources deleted.
func (r *ReconciliationResult) DeletedCount() int {
	return len(r.deleted)
}

// ErrorCount returns the number of errors that occurred.
func (r *ReconciliationResult) ErrorCount() int {
	return len(r.errors)
}

// ToProtoSummary converts the result to a ReconciliationSummary proto message.
//
// This is used to populate the Apply() response with reconciliation details.
func (r *ReconciliationResult) ToProtoSummary() *projectv1.ReconciliationSummary {
	return &projectv1.ReconciliationSummary{
		Created: slices.Clone(r.created),
		Updated: slices.Clone(r.updated),
		Deleted: slices.Clone(r.deleted),
	}
}

// ResultBuilder provides incremental construction of ReconciliationResult.
//
// ResultBuilder is used during reconciliation execution to accumulate
// successes and failures as each resource is processed.
//
// Example:
//
//	builder := NewResultBuilder()
//	for _, change := range plan.AllChanges() {
//	    record, err := execute(change)
//	    if err != nil {
//	        builder.AddError(NewReconciliationErrorWithCause(
//	            change.Key().String(), "execution failed", err))
//	    } else {
//	        builder.AddSuccess(change.ChangeType(), record)
//	    }
//	}
//	result := builder.Build()
type ResultBuilder struct {
	created []*projectv1.ResourceChangeRecord
	updated []*projectv1.ResourceChangeRecord
	deleted []*projectv1.ResourceChangeRecord
	errors  []ReconciliationError
}

// NewResultBuilder creates a new ResultBuilder for incremental result construction.
func NewResultBuilder() *ResultBuilder {
	return &ResultBuilder{
		created: []*projectv1.ResourceChangeRecord{},
		updated: []*projectv1.ResourceChangeRecord{},
		deleted: []*projectv1.ResourceChangeRecord{},
		errors:  []ReconciliationError{},
	}
}

// AddCreated records a successfully created resource.
func (b *ResultBuilder) AddCreated(record *projectv1.ResourceChangeRecord) *ResultBuilder {
	b.created = append(b.created, record)
	return b
}

// AddUpdated records a successfully updated resource.
func (b *ResultBuilder) AddUpdated(record *projectv1.ResourceChangeRecord) *ResultBuilder {
	b.updated = append(b.updated, record)
	return b
}

// AddDeleted records a successfully deleted resource.
func (b *ResultBuilder) AddDeleted(record *projectv1.ResourceChangeRecord) *ResultBuilder {
	b.deleted = append(b.deleted, record)
	return b
}

// AddError records a reconciliation error.
func (b *ResultBuilder) AddError(err ReconciliationError) *ResultBuilder {
	b.errors = append(b.errors, err)
	return b
}

// Build creates an immutable ReconciliationResult from the accumulated data.
//
// The builder can be reused after Build() is called, but it's recommended
// to create a new builder for each reconciliation.
func (b *ResultBuilder) Build() *ReconciliationResult {
	return &ReconciliationResult{
		created: cloneRecordSlice(b.created),
		updated: cloneRecordSlice(b.updated),
		deleted: cloneRecordSlice(b.deleted),
		errors:  cloneErrorSlice(b.errors),
	}
}

// Helper functions for defensive copying

func cloneRecordSlice(s []*projectv1.ResourceChangeRecord) []*projectv1.ResourceChangeRecord {
	if s == nil {
		return []*projectv1.ResourceChangeRecord{}
	}
	return slices.Clone(s)
}

func cloneErrorSlice(s []ReconciliationError) []ReconciliationError {
	if s == nil {
		return []ReconciliationError{}
	}
	return slices.Clone(s)
}

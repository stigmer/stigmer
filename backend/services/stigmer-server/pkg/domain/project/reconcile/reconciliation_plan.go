package reconcile

import "slices"

// emptyPlan is a singleton empty ReconciliationPlan for reuse.
var emptyPlan = &ReconciliationPlan{
	creates: []ResourceChange{},
	updates: []ResourceChange{},
	deletes: []ResourceChange{},
}

// ReconciliationPlan is an immutable container for computed changes.
//
// ReconciliationPlan holds the results of comparing desired state with actual state.
// Changes are organized into three categories:
//   - creates: Resources that exist in desired state but not in actual state
//   - updates: Resources that exist in both states but have different specs
//   - deletes: Resources that exist in actual state but not in desired state (orphans)
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - Getters return defensive copies to prevent external mutation
//   - There are no setters
//
// Example:
//
//	plan := NewReconciliationPlan(creates, updates, deletes)
//	fmt.Printf("Plan has %d changes\n", plan.TotalChanges())
//	if !plan.IsEmpty() {
//	    for _, change := range plan.AllChanges() {
//	        fmt.Println(change)
//	    }
//	}
type ReconciliationPlan struct {
	creates []ResourceChange
	updates []ResourceChange
	deletes []ResourceChange
}

// NewReconciliationPlan creates a new ReconciliationPlan with the given changes.
//
// The constructor performs defensive copying of all slices to ensure immutability.
// Nil slices are converted to empty slices.
//
// Example:
//
//	creates := []ResourceChange{NewCreateChange(key, proto)}
//	plan := NewReconciliationPlan(creates, nil, nil)
//	// Modifying the original slice doesn't affect the plan
//	creates[0] = ResourceChange{}
//	plan.Creates()[0] // Still the original change
func NewReconciliationPlan(creates, updates, deletes []ResourceChange) *ReconciliationPlan {
	return &ReconciliationPlan{
		creates: cloneChangeSlice(creates),
		updates: cloneChangeSlice(updates),
		deletes: cloneChangeSlice(deletes),
	}
}

// EmptyPlan returns a singleton empty ReconciliationPlan.
//
// This is more efficient than creating new empty plans repeatedly.
// Use this when no changes are needed (desired state matches actual state).
func EmptyPlan() *ReconciliationPlan {
	return emptyPlan
}

// Creates returns a defensive copy of the create changes.
//
// Callers can safely modify the returned slice without affecting the plan.
func (p *ReconciliationPlan) Creates() []ResourceChange {
	return slices.Clone(p.creates)
}

// Updates returns a defensive copy of the update changes.
//
// Callers can safely modify the returned slice without affecting the plan.
func (p *ReconciliationPlan) Updates() []ResourceChange {
	return slices.Clone(p.updates)
}

// Deletes returns a defensive copy of the delete changes.
//
// Callers can safely modify the returned slice without affecting the plan.
func (p *ReconciliationPlan) Deletes() []ResourceChange {
	return slices.Clone(p.deletes)
}

// IsEmpty returns true if there are no changes in the plan.
func (p *ReconciliationPlan) IsEmpty() bool {
	return len(p.creates) == 0 && len(p.updates) == 0 && len(p.deletes) == 0
}

// TotalChanges returns the total count of all changes.
func (p *ReconciliationPlan) TotalChanges() int {
	return len(p.creates) + len(p.updates) + len(p.deletes)
}

// AllChanges returns all changes combined in order: creates, updates, deletes.
//
// This is useful for iteration when the change type doesn't matter.
// Returns a new slice (defensive copy).
//
// Note: For ordered execution that respects dependencies, use
// GetChangesInExecutionOrder() (implemented in Phase C2).
func (p *ReconciliationPlan) AllChanges() []ResourceChange {
	result := make([]ResourceChange, 0, p.TotalChanges())
	result = append(result, p.creates...)
	result = append(result, p.updates...)
	result = append(result, p.deletes...)
	return result
}

// CreateCount returns the number of create changes.
func (p *ReconciliationPlan) CreateCount() int {
	return len(p.creates)
}

// UpdateCount returns the number of update changes.
func (p *ReconciliationPlan) UpdateCount() int {
	return len(p.updates)
}

// DeleteCount returns the number of delete changes.
func (p *ReconciliationPlan) DeleteCount() int {
	return len(p.deletes)
}

// cloneChangeSlice returns a defensive copy of a ResourceChange slice.
func cloneChangeSlice(s []ResourceChange) []ResourceChange {
	if s == nil {
		return []ResourceChange{}
	}
	return slices.Clone(s)
}

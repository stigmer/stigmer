package reconcile

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestNewReconciliationPlan(t *testing.T) {
	creates := []ResourceChange{
		NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1"), nil),
		NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent2"), nil),
	}
	updates := []ResourceChange{
		NewUpdateChange(MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "wf1"), nil, nil),
	}
	deletes := []ResourceChange{
		NewDeleteChange(MustResourceKey(apiresourcekind.ApiResourceKind_skill, "sk1"), nil),
	}

	plan := NewReconciliationPlan(creates, updates, deletes)

	t.Run("has correct create count", func(t *testing.T) {
		if plan.CreateCount() != 2 {
			t.Errorf("expected 2 creates, got %d", plan.CreateCount())
		}
	})

	t.Run("has correct update count", func(t *testing.T) {
		if plan.UpdateCount() != 1 {
			t.Errorf("expected 1 update, got %d", plan.UpdateCount())
		}
	})

	t.Run("has correct delete count", func(t *testing.T) {
		if plan.DeleteCount() != 1 {
			t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
		}
	})

	t.Run("has correct total", func(t *testing.T) {
		if plan.TotalChanges() != 4 {
			t.Errorf("expected 4 total changes, got %d", plan.TotalChanges())
		}
	})
}

func TestEmptyPlan(t *testing.T) {
	plan := EmptyPlan()

	t.Run("is singleton", func(t *testing.T) {
		plan2 := EmptyPlan()
		if plan != plan2 {
			t.Error("expected EmptyPlan to return same instance")
		}
	})

	t.Run("is empty", func(t *testing.T) {
		if !plan.IsEmpty() {
			t.Error("expected empty plan to be empty")
		}
	})

	t.Run("has zero creates", func(t *testing.T) {
		if plan.CreateCount() != 0 {
			t.Errorf("expected 0 creates, got %d", plan.CreateCount())
		}
	})

	t.Run("has zero updates", func(t *testing.T) {
		if plan.UpdateCount() != 0 {
			t.Errorf("expected 0 updates, got %d", plan.UpdateCount())
		}
	})

	t.Run("has zero deletes", func(t *testing.T) {
		if plan.DeleteCount() != 0 {
			t.Errorf("expected 0 deletes, got %d", plan.DeleteCount())
		}
	})

	t.Run("has zero total", func(t *testing.T) {
		if plan.TotalChanges() != 0 {
			t.Errorf("expected 0 total, got %d", plan.TotalChanges())
		}
	})
}

func TestReconciliationPlan_IsEmpty(t *testing.T) {
	tests := []struct {
		name     string
		creates  []ResourceChange
		updates  []ResourceChange
		deletes  []ResourceChange
		expected bool
	}{
		{
			name:     "all nil slices is empty",
			creates:  nil,
			updates:  nil,
			deletes:  nil,
			expected: true,
		},
		{
			name:     "all empty slices is empty",
			creates:  []ResourceChange{},
			updates:  []ResourceChange{},
			deletes:  []ResourceChange{},
			expected: true,
		},
		{
			name: "with creates is not empty",
			creates: []ResourceChange{
				NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "a"), nil),
			},
			updates:  nil,
			deletes:  nil,
			expected: false,
		},
		{
			name:    "with updates is not empty",
			creates: nil,
			updates: []ResourceChange{
				NewUpdateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "a"), nil, nil),
			},
			deletes:  nil,
			expected: false,
		},
		{
			name:    "with deletes is not empty",
			creates: nil,
			updates: nil,
			deletes: []ResourceChange{
				NewDeleteChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "a"), nil),
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan := NewReconciliationPlan(tt.creates, tt.updates, tt.deletes)
			if plan.IsEmpty() != tt.expected {
				t.Errorf("IsEmpty() = %v, expected %v", plan.IsEmpty(), tt.expected)
			}
		})
	}
}

func TestReconciliationPlan_TotalChanges(t *testing.T) {
	tests := []struct {
		name     string
		creates  int
		updates  int
		deletes  int
		expected int
	}{
		{"no changes", 0, 0, 0, 0},
		{"only creates", 3, 0, 0, 3},
		{"only updates", 0, 2, 0, 2},
		{"only deletes", 0, 0, 1, 1},
		{"mixed changes", 2, 3, 1, 6},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			creates := makeChanges(ChangeTypeCreate, tt.creates)
			updates := makeChanges(ChangeTypeUpdate, tt.updates)
			deletes := makeChanges(ChangeTypeDelete, tt.deletes)

			plan := NewReconciliationPlan(creates, updates, deletes)
			if plan.TotalChanges() != tt.expected {
				t.Errorf("TotalChanges() = %d, expected %d", plan.TotalChanges(), tt.expected)
			}
		})
	}
}

func TestReconciliationPlan_DefensiveCopy(t *testing.T) {
	original := []ResourceChange{
		NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1"), nil),
	}

	plan := NewReconciliationPlan(original, nil, nil)

	t.Run("modifying input doesn't affect plan", func(t *testing.T) {
		original[0] = NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "wf1"), nil)
		creates := plan.Creates()
		if creates[0].Key().Kind() != apiresourcekind.ApiResourceKind_agent {
			t.Error("modifying input affected plan")
		}
	})

	t.Run("modifying output doesn't affect plan", func(t *testing.T) {
		creates := plan.Creates()
		creates[0] = NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "wf2"), nil)

		creates2 := plan.Creates()
		if creates2[0].Key().Kind() != apiresourcekind.ApiResourceKind_agent {
			t.Error("modifying output affected plan")
		}
	})
}

func TestReconciliationPlan_AllChanges(t *testing.T) {
	creates := []ResourceChange{
		NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "a1"), nil),
		NewCreateChange(MustResourceKey(apiresourcekind.ApiResourceKind_agent, "a2"), nil),
	}
	updates := []ResourceChange{
		NewUpdateChange(MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "w1"), nil, nil),
	}
	deletes := []ResourceChange{
		NewDeleteChange(MustResourceKey(apiresourcekind.ApiResourceKind_skill, "s1"), nil),
	}

	plan := NewReconciliationPlan(creates, updates, deletes)
	all := plan.AllChanges()

	t.Run("has correct count", func(t *testing.T) {
		if len(all) != 4 {
			t.Errorf("expected 4 changes, got %d", len(all))
		}
	})

	t.Run("creates come first", func(t *testing.T) {
		if !all[0].IsCreate() || !all[1].IsCreate() {
			t.Error("expected creates to come first")
		}
	})

	t.Run("updates come second", func(t *testing.T) {
		if !all[2].IsUpdate() {
			t.Error("expected updates after creates")
		}
	})

	t.Run("deletes come last", func(t *testing.T) {
		if !all[3].IsDelete() {
			t.Error("expected deletes last")
		}
	})

	t.Run("returns defensive copy", func(t *testing.T) {
		all[0] = NewDeleteChange(MustResourceKey(apiresourcekind.ApiResourceKind_skill, "mod"), nil)
		all2 := plan.AllChanges()
		if all2[0].IsDelete() {
			t.Error("modifying AllChanges result affected plan")
		}
	})
}

// Helper function to create test changes
func makeChanges(changeType ChangeType, count int) []ResourceChange {
	changes := make([]ResourceChange, count)
	for i := 0; i < count; i++ {
		key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test")
		switch changeType {
		case ChangeTypeCreate:
			changes[i] = NewCreateChange(key, nil)
		case ChangeTypeUpdate:
			changes[i] = NewUpdateChange(key, nil, nil)
		case ChangeTypeDelete:
			changes[i] = NewDeleteChange(key, nil)
		}
	}
	return changes
}

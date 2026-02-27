package reconcile

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestEmptyResult(t *testing.T) {
	result := EmptyResult()

	t.Run("is singleton", func(t *testing.T) {
		result2 := EmptyResult()
		if result != result2 {
			t.Error("expected EmptyResult to return same instance")
		}
	})

	t.Run("has no added", func(t *testing.T) {
		if len(result.Added()) != 0 {
			t.Errorf("expected 0 added, got %d", len(result.Added()))
		}
	})

	t.Run("has no removed", func(t *testing.T) {
		if len(result.Removed()) != 0 {
			t.Errorf("expected 0 removed, got %d", len(result.Removed()))
		}
	})

	t.Run("has no errors", func(t *testing.T) {
		if len(result.Errors()) != 0 {
			t.Errorf("expected 0 errors, got %d", len(result.Errors()))
		}
	})

	t.Run("is success", func(t *testing.T) {
		if !result.IsSuccess() {
			t.Error("expected IsSuccess to be true")
		}
	})

	t.Run("counts are zero", func(t *testing.T) {
		if result.AddedCount() != 0 {
			t.Errorf("expected AddedCount 0, got %d", result.AddedCount())
		}
		if result.RemovedCount() != 0 {
			t.Errorf("expected RemovedCount 0, got %d", result.RemovedCount())
		}
		if result.ErrorCount() != 0 {
			t.Errorf("expected ErrorCount 0, got %d", result.ErrorCount())
		}
	})
}

func TestNewResult(t *testing.T) {
	added := []*apiresource.ApiResourceReference{
		{Org: "local", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "new-agent"},
	}
	removed := []*apiresource.ApiResourceReference{
		{Org: "local", Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "old-workflow"},
	}
	errors := []ReconciliationError{
		NewReconciliationError("skill:broken", "failed to delete"),
	}

	result := NewResult(added, removed, errors)

	t.Run("added count", func(t *testing.T) {
		if result.AddedCount() != 1 {
			t.Errorf("expected 1 added, got %d", result.AddedCount())
		}
	})

	t.Run("removed count", func(t *testing.T) {
		if result.RemovedCount() != 1 {
			t.Errorf("expected 1 removed, got %d", result.RemovedCount())
		}
	})

	t.Run("has errors", func(t *testing.T) {
		if !result.HasErrors() {
			t.Error("expected HasErrors to be true")
		}
		if result.IsSuccess() {
			t.Error("expected IsSuccess to be false")
		}
	})

	t.Run("defensive copy on added", func(t *testing.T) {
		returned := result.Added()
		returned[0] = nil
		if result.Added()[0] == nil {
			t.Error("modifying returned slice should not affect result")
		}
	})

	t.Run("defensive copy on removed", func(t *testing.T) {
		returned := result.Removed()
		returned[0] = nil
		if result.Removed()[0] == nil {
			t.Error("modifying returned slice should not affect result")
		}
	})
}

func TestNewResult_NilSlices(t *testing.T) {
	result := NewResult(nil, nil, nil)

	if result.Added() == nil {
		t.Error("expected Added() to return empty slice, not nil")
	}
	if result.Removed() == nil {
		t.Error("expected Removed() to return empty slice, not nil")
	}
	if result.Errors() == nil {
		t.Error("expected Errors() to return empty slice, not nil")
	}
}

func TestReconciliationResult_ToProtoSummary(t *testing.T) {
	agentRef := &apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "my-agent",
	}
	workflowRef := &apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "old-wf",
	}

	result := NewResult(
		[]*apiresource.ApiResourceReference{agentRef},
		[]*apiresource.ApiResourceReference{workflowRef},
		nil,
	)

	summary := result.ToProtoSummary()

	t.Run("added maps to created", func(t *testing.T) {
		if len(summary.Created) != 1 {
			t.Fatalf("expected 1 created, got %d", len(summary.Created))
		}
		if summary.Created[0].GetSlug() != "my-agent" {
			t.Errorf("expected slug 'my-agent', got %q", summary.Created[0].GetSlug())
		}
	})

	t.Run("updated is empty", func(t *testing.T) {
		if len(summary.Updated) != 0 {
			t.Errorf("expected 0 updated, got %d", len(summary.Updated))
		}
	})

	t.Run("removed maps to deleted", func(t *testing.T) {
		if len(summary.Deleted) != 1 {
			t.Fatalf("expected 1 deleted, got %d", len(summary.Deleted))
		}
		if summary.Deleted[0].GetSlug() != "old-wf" {
			t.Errorf("expected slug 'old-wf', got %q", summary.Deleted[0].GetSlug())
		}
	})
}

func TestResultBuilder(t *testing.T) {
	agentRef := &apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "a1",
	}
	workflowRef := &apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "w1",
	}
	reconcileErr := NewReconciliationError("skill:s1", "delete failed")

	builder := NewResultBuilder()
	builder.AddAdded(agentRef)
	builder.AddRemoved(workflowRef)
	builder.AddError(reconcileErr)

	result := builder.Build()

	if result.AddedCount() != 1 {
		t.Errorf("expected 1 added, got %d", result.AddedCount())
	}
	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed, got %d", result.RemovedCount())
	}
	if result.ErrorCount() != 1 {
		t.Errorf("expected 1 error, got %d", result.ErrorCount())
	}
}

func TestResultBuilder_Build_DefensiveCopy(t *testing.T) {
	ref := &apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "a1",
	}

	builder := NewResultBuilder()
	builder.AddAdded(ref)
	result := builder.Build()

	// Modify builder after build
	builder.AddAdded(&apiresource.ApiResourceReference{
		Org: "local", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "a2",
	})

	if result.AddedCount() != 1 {
		t.Error("building additional items should not affect previously built result")
	}
}

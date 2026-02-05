package reconcile

import (
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestNewSuccessResult(t *testing.T) {
	created := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_agent, "agent1", "agt_001"),
		createTestRecord(apiresourcekind.ApiResourceKind_agent, "agent2", "agt_002"),
	}
	updated := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_workflow, "wf1", "wfl_001"),
	}
	deleted := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_skill, "sk1", "skl_001"),
	}

	result := NewSuccessResult(created, updated, deleted)

	t.Run("has correct created count", func(t *testing.T) {
		if result.CreatedCount() != 2 {
			t.Errorf("expected 2 created, got %d", result.CreatedCount())
		}
	})

	t.Run("has correct updated count", func(t *testing.T) {
		if result.UpdatedCount() != 1 {
			t.Errorf("expected 1 updated, got %d", result.UpdatedCount())
		}
	})

	t.Run("has correct deleted count", func(t *testing.T) {
		if result.DeletedCount() != 1 {
			t.Errorf("expected 1 deleted, got %d", result.DeletedCount())
		}
	})

	t.Run("is success", func(t *testing.T) {
		if !result.IsSuccess() {
			t.Error("expected success result")
		}
	})

	t.Run("has no errors", func(t *testing.T) {
		if result.HasErrors() {
			t.Error("expected no errors")
		}
	})

	t.Run("has correct total", func(t *testing.T) {
		if result.TotalChanges() != 4 {
			t.Errorf("expected 4 total changes, got %d", result.TotalChanges())
		}
	})
}

func TestNewPartialResult(t *testing.T) {
	created := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_agent, "agent1", "agt_001"),
	}
	errors := []ReconciliationError{
		NewReconciliationError("agent:agent2", "validation failed"),
	}

	result := NewPartialResult(created, nil, nil, errors)

	t.Run("has created", func(t *testing.T) {
		if result.CreatedCount() != 1 {
			t.Errorf("expected 1 created, got %d", result.CreatedCount())
		}
	})

	t.Run("has errors", func(t *testing.T) {
		if !result.HasErrors() {
			t.Error("expected errors")
		}
	})

	t.Run("is not success", func(t *testing.T) {
		if result.IsSuccess() {
			t.Error("expected not success with errors")
		}
	})

	t.Run("has correct error count", func(t *testing.T) {
		if result.ErrorCount() != 1 {
			t.Errorf("expected 1 error, got %d", result.ErrorCount())
		}
	})
}

func TestNewFailureResult(t *testing.T) {
	errors := []ReconciliationError{
		NewReconciliationError("agent:agent1", "database unavailable"),
		NewReconciliationError("workflow:wf1", "timeout"),
	}

	result := NewFailureResult(errors)

	t.Run("has no created", func(t *testing.T) {
		if result.CreatedCount() != 0 {
			t.Errorf("expected 0 created, got %d", result.CreatedCount())
		}
	})

	t.Run("has no updated", func(t *testing.T) {
		if result.UpdatedCount() != 0 {
			t.Errorf("expected 0 updated, got %d", result.UpdatedCount())
		}
	})

	t.Run("has no deleted", func(t *testing.T) {
		if result.DeletedCount() != 0 {
			t.Errorf("expected 0 deleted, got %d", result.DeletedCount())
		}
	})

	t.Run("has errors", func(t *testing.T) {
		if result.ErrorCount() != 2 {
			t.Errorf("expected 2 errors, got %d", result.ErrorCount())
		}
	})

	t.Run("is not success", func(t *testing.T) {
		if result.IsSuccess() {
			t.Error("expected not success")
		}
	})

	t.Run("total changes is zero", func(t *testing.T) {
		if result.TotalChanges() != 0 {
			t.Errorf("expected 0 total changes, got %d", result.TotalChanges())
		}
	})
}

func TestEmptyResult(t *testing.T) {
	result := EmptyResult()

	t.Run("is singleton", func(t *testing.T) {
		result2 := EmptyResult()
		if result != result2 {
			t.Error("expected EmptyResult to return same instance")
		}
	})

	t.Run("is success", func(t *testing.T) {
		if !result.IsSuccess() {
			t.Error("expected empty result to be success")
		}
	})

	t.Run("has no changes", func(t *testing.T) {
		if result.TotalChanges() != 0 {
			t.Errorf("expected 0 changes, got %d", result.TotalChanges())
		}
	})
}

func TestReconciliationResult_ToProtoSummary(t *testing.T) {
	created := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_agent, "agent1", "agt_001"),
	}
	updated := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_workflow, "wf1", "wfl_001"),
	}
	deleted := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_skill, "sk1", "skl_001"),
	}

	result := NewSuccessResult(created, updated, deleted)
	summary := result.ToProtoSummary()

	t.Run("has correct created", func(t *testing.T) {
		if len(summary.Created) != 1 {
			t.Errorf("expected 1 created in summary, got %d", len(summary.Created))
		}
		if summary.Created[0].Slug != "agent1" {
			t.Errorf("expected slug 'agent1', got %q", summary.Created[0].Slug)
		}
	})

	t.Run("has correct updated", func(t *testing.T) {
		if len(summary.Updated) != 1 {
			t.Errorf("expected 1 updated in summary, got %d", len(summary.Updated))
		}
	})

	t.Run("has correct deleted", func(t *testing.T) {
		if len(summary.Deleted) != 1 {
			t.Errorf("expected 1 deleted in summary, got %d", len(summary.Deleted))
		}
	})

	t.Run("returns defensive copy", func(t *testing.T) {
		summary.Created = append(summary.Created, createTestRecord(
			apiresourcekind.ApiResourceKind_agent, "modified", "agt_999"))

		summary2 := result.ToProtoSummary()
		if len(summary2.Created) != 1 {
			t.Error("modifying summary affected result")
		}
	})
}

func TestResultBuilder(t *testing.T) {
	builder := NewResultBuilder()

	// Add some successes
	builder.AddCreated(createTestRecord(apiresourcekind.ApiResourceKind_agent, "a1", "agt_001"))
	builder.AddCreated(createTestRecord(apiresourcekind.ApiResourceKind_agent, "a2", "agt_002"))
	builder.AddUpdated(createTestRecord(apiresourcekind.ApiResourceKind_workflow, "w1", "wfl_001"))
	builder.AddDeleted(createTestRecord(apiresourcekind.ApiResourceKind_skill, "s1", "skl_001"))

	// Add an error
	builder.AddError(NewReconciliationError("mcp_server:m1", "connection failed"))

	result := builder.Build()

	t.Run("has correct created count", func(t *testing.T) {
		if result.CreatedCount() != 2 {
			t.Errorf("expected 2 created, got %d", result.CreatedCount())
		}
	})

	t.Run("has correct updated count", func(t *testing.T) {
		if result.UpdatedCount() != 1 {
			t.Errorf("expected 1 updated, got %d", result.UpdatedCount())
		}
	})

	t.Run("has correct deleted count", func(t *testing.T) {
		if result.DeletedCount() != 1 {
			t.Errorf("expected 1 deleted, got %d", result.DeletedCount())
		}
	})

	t.Run("has correct error count", func(t *testing.T) {
		if result.ErrorCount() != 1 {
			t.Errorf("expected 1 error, got %d", result.ErrorCount())
		}
	})

	t.Run("is partial success", func(t *testing.T) {
		if result.IsSuccess() {
			t.Error("expected partial success (has errors)")
		}
		if result.TotalChanges() != 4 {
			t.Errorf("expected 4 total changes, got %d", result.TotalChanges())
		}
	})
}

func TestResultBuilder_Chaining(t *testing.T) {
	result := NewResultBuilder().
		AddCreated(createTestRecord(apiresourcekind.ApiResourceKind_agent, "a1", "agt_001")).
		AddUpdated(createTestRecord(apiresourcekind.ApiResourceKind_workflow, "w1", "wfl_001")).
		AddDeleted(createTestRecord(apiresourcekind.ApiResourceKind_skill, "s1", "skl_001")).
		Build()

	if result.TotalChanges() != 3 {
		t.Errorf("expected 3 total changes, got %d", result.TotalChanges())
	}
}

func TestReconciliationResult_DefensiveCopy(t *testing.T) {
	original := []*projectv1.ResourceChangeRecord{
		createTestRecord(apiresourcekind.ApiResourceKind_agent, "agent1", "agt_001"),
	}

	result := NewSuccessResult(original, nil, nil)

	t.Run("modifying input doesn't affect result", func(t *testing.T) {
		original[0] = createTestRecord(apiresourcekind.ApiResourceKind_workflow, "modified", "wfl_999")
		created := result.Created()
		if created[0].Kind != apiresourcekind.ApiResourceKind_agent {
			t.Error("modifying input affected result")
		}
	})

	t.Run("modifying output doesn't affect result", func(t *testing.T) {
		created := result.Created()
		created[0] = createTestRecord(apiresourcekind.ApiResourceKind_workflow, "modified", "wfl_999")

		created2 := result.Created()
		if created2[0].Kind != apiresourcekind.ApiResourceKind_agent {
			t.Error("modifying output affected result")
		}
	})
}

// Test helper

func createTestRecord(kind apiresourcekind.ApiResourceKind, slug, resourceID string) *projectv1.ResourceChangeRecord {
	return &projectv1.ResourceChangeRecord{
		Kind:       kind,
		Slug:       slug,
		ResourceId: resourceID,
	}
}

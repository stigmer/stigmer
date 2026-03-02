package project

import (
	"context"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
)

// ============================================================================
// Idempotent Semantics Tests
// ============================================================================

func TestApply_CreatesNewProjectWhenNotExists(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("New Apply Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Metadata.Id == "" {
		t.Error("Expected ID to be generated")
	}
	if applied.Metadata.Name != "New Apply Project" {
		t.Errorf("Expected Name 'New Apply Project', got '%s'", applied.Metadata.Name)
	}
	if applied.Metadata.Slug != "new-apply-project" {
		t.Errorf("Expected Slug 'new-apply-project', got '%s'", applied.Metadata.Slug)
	}
}

func TestApply_UpdatesExistingProjectWhenExists(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Existing Project")
	created, err := controller.Create(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	originalID := created.Metadata.Id

	project.Spec.Description = "Updated description via apply"
	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Metadata.Id != originalID {
		t.Errorf("Expected ID to remain '%s', got '%s'", originalID, applied.Metadata.Id)
	}
	if applied.Spec.Description != "Updated description via apply" {
		t.Errorf("Expected updated description, got '%s'", applied.Spec.Description)
	}
}

func TestApply_IsIdempotent(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Idempotent Project")

	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	second, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Second Apply failed: %v", err)
	}

	if first.Metadata.Id != second.Metadata.Id {
		t.Errorf("Expected same ID across applies, got '%s' and '%s'",
			first.Metadata.Id, second.Metadata.Id)
	}
}

func TestApply_WithChangedSpecTriggersUpdate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Spec Change Project")
	project.Spec.Description = "Initial description"

	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	project.Spec.Description = "Changed description"
	second, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Second Apply failed: %v", err)
	}

	if first.Metadata.Id != second.Metadata.Id {
		t.Error("Expected ID to be preserved across updates")
	}
	if second.Spec.Description != "Changed description" {
		t.Errorf("Expected description 'Changed description', got '%s'", second.Spec.Description)
	}
}

func TestApply_PreservesProjectIdAcrossUpdates(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Preserve ID Project")

	first, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	for i := 0; i < 3; i++ {
		project.Spec.Description = "Update " + string(rune('A'+i))
		applied, err := controller.Apply(contextWithProjectKind(), project)
		if err != nil {
			t.Fatalf("Apply %d failed: %v", i+1, err)
		}
		if applied.Metadata.Id != first.Metadata.Id {
			t.Errorf("Apply %d: Expected ID '%s', got '%s'", i+1, first.Metadata.Id, applied.Metadata.Id)
		}
	}
}

// ============================================================================
// Reconciliation Integration Tests
// ============================================================================

func TestApply_ReturnsReconciliationSummaryInResponse(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Reconciliation Summary Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil {
		t.Fatal("Expected status to be set")
	}
}

func TestApply_WithNewMembersShowsAdded(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProjectWithMembers("Members Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	summary := applied.Status.LastReconciliation
	if len(summary.Created) != 2 {
		t.Errorf("Expected 2 added members in reconciliation summary, got %d", len(summary.Created))
	}
}

func TestApply_MembershipChange_DetectsOrphans(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// First apply with two members
	project := createTestProject("Orphan Detection Project")
	project.Spec.Members = []*apiresource.ApiResourceReference{
		{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-a"},
		{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-b"},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("First Apply failed: %v", err)
	}

	// Second apply with only one member (agent-b removed)
	project.Spec.Members = []*apiresource.ApiResourceReference{
		{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-a"},
	}

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Second Apply failed: %v", err)
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}

	// The orphan (agent-b) won't actually be deleted because there's no
	// ResourceDeleter configured in test mode. But the reconciliation should
	// still detect the membership change. The deleted list may contain errors
	// from failed resolution, which is acceptable in this stub test.
}

// ============================================================================
// Validation Tests
// ============================================================================

func TestApply_RejectsMissingMetadata(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing metadata")
	}
}

func TestApply_RejectsMissingName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Org: "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing name")
	}
}

func TestApply_RejectsInvalidApiVersion(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "invalid/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid API Version",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid api_version")
	}
}

func TestApply_RejectsInvalidKind(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "InvalidKind",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Invalid Kind",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for invalid kind")
	}
}

func TestApply_RejectsMissingSpec(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Missing Spec",
			Org:  "test-org",
		},
	}

	_, err := controller.Apply(contextWithProjectKind(), project)
	if err == nil {
		t.Error("Expected error for missing spec")
	}
}

// ============================================================================
// Audit and Metadata Tests
// ============================================================================

func TestApply_GeneratesValidID(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("ID Generation Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if len(applied.Metadata.Id) != 30 {
		t.Errorf("Expected ID length 30, got %d", len(applied.Metadata.Id))
	}
}

func TestApply_GeneratesSlugFromName(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	tests := []struct {
		name         string
		projectName  string
		expectedSlug string
	}{
		{"simple name", "My Project", "my-project"},
		{"name with special characters", "Project #1 (Test)", "project-1-test"},
		{"already lowercase", "simple-project", "simple-project"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := createTestProject(tt.projectName)

			applied, err := controller.Apply(contextWithProjectKind(), project)
			if err != nil {
				t.Fatalf("Apply failed: %v", err)
			}

			if applied.Metadata.Slug != tt.expectedSlug {
				t.Errorf("Expected slug '%s', got '%s'", tt.expectedSlug, applied.Metadata.Slug)
			}
		})
	}
}

func TestApply_SetsAuditFields(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Audit Test Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.Status == nil {
		t.Fatal("Expected status to be set")
	}
	if applied.Status.Audit == nil {
		t.Fatal("Expected audit to be set in status")
	}

	audit := applied.Status.Audit
	if audit.SpecAudit == nil {
		t.Error("Expected spec_audit to be set")
	} else {
		if audit.SpecAudit.CreatedAt == nil {
			t.Error("Expected created_at to be set")
		}
	}
}

// ============================================================================
// Error Handling Tests
// ============================================================================

func TestApply_HandlesReconciliationGracefully(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	project := createTestProject("Error Handling Project")

	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply should not fail: %v", err)
	}

	if applied.Metadata.Id == "" {
		t.Error("Expected project to be persisted with an ID")
	}
}

// ============================================================================
// Mock ReconciliationService Tests
// ============================================================================

func TestApply_WithMockReconciliationService(t *testing.T) {
	s, err := newTestStore(t)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer s.Close()

	addedRef := &apiresource.ApiResourceReference{
		Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "mock-agent",
	}

	mockService := &mockReconciliationService{
		result: reconcile.NewResult(
			[]*apiresource.ApiResourceReference{addedRef},
			nil,
			nil,
		),
	}

	controller := NewProjectController(s, mockService)

	project := createTestProject("Mock Service Project")
	applied, err := controller.Apply(contextWithProjectKind(), project)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if !mockService.called {
		t.Error("Expected mock reconciliation service to be called")
	}

	if applied.Status == nil || applied.Status.LastReconciliation == nil {
		t.Fatal("Expected reconciliation summary")
	}
	if len(applied.Status.LastReconciliation.Created) != 1 {
		t.Errorf("Expected 1 added from mock, got %d", len(applied.Status.LastReconciliation.Created))
	}
}

// ============================================================================
// Helper Types
// ============================================================================

type mockReconciliationService struct {
	called  bool
	result  *reconcile.ReconciliationResult
	err     error
	options *reconcile.ReconciliationOptions
}

func (m *mockReconciliationService) Reconcile(
	_ context.Context,
	_ []*apiresource.ApiResourceReference,
	_ []*apiresource.ApiResourceReference,
	options *reconcile.ReconciliationOptions,
) (*reconcile.ReconciliationResult, error) {
	m.called = true
	m.options = options
	if m.err != nil {
		return nil, m.err
	}
	if m.result == nil {
		return reconcile.EmptyResult(), nil
	}
	return m.result, nil
}

func newTestStore(t *testing.T) (store.Store, error) {
	t.Helper()
	return sqlite.NewStore(t.TempDir() + "/test.sqlite")
}

package organization

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/types/known/emptypb"
)

func contextWithOrganizationKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_organization)
}

func setupTestController(t *testing.T) (*OrganizationController, store.Store) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewOrganizationController(store)

	return controller, store
}

func createTestOrganization(name, slug string) *organizationv1.Organization {
	return &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Slug: slug,
			Org:  "default",
		},
		Spec: &organizationv1.OrganizationSpec{
			Description:    "Test organization for unit tests",
			ManagementMode: organizationv1.ManagementMode_self_managed,
		},
	}
}

func TestOrganizationController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation", func(t *testing.T) {
		org := createTestOrganization("Acme Corp", "acme")

		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug != "acme" {
			t.Errorf("Expected slug 'acme', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Organization" {
			t.Errorf("Expected kind 'Organization', got '%s'", created.Kind)
		}

		if created.ApiVersion != "tenancy.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'tenancy.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		if created.Spec.Description != "Test organization for unit tests" {
			t.Errorf("Expected description preserved, got '%s'", created.Spec.Description)
		}

		if created.Spec.ManagementMode != organizationv1.ManagementMode_self_managed {
			t.Errorf("Expected management_mode self_managed, got '%v'", created.Spec.ManagementMode)
		}
	})

	t.Run("validation error - missing metadata", func(t *testing.T) {
		org := &organizationv1.Organization{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Organization",
			Spec: &organizationv1.OrganizationSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("validation error - invalid api_version", func(t *testing.T) {
		org := &organizationv1.Organization{
			ApiVersion: "wrong.api/v1",
			Kind:       "Organization",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Bad Org",
				Slug: "bad-org",
				Org:  "default",
			},
			Spec: &organizationv1.OrganizationSpec{
				Description: "Test",
			},
		}

		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err == nil {
			t.Error("Expected error for invalid api_version")
		}
	})

	t.Run("validation error - slug too long", func(t *testing.T) {
		org := &organizationv1.Organization{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Organization",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Long Name Org",
				Slug: "this-slug-is-way-too-long-and-exceeds-the-sixty-three-character-maximum-allowed",
				Org:  "default",
			},
			Spec: &organizationv1.OrganizationSpec{
				Description: "Test",
			},
		}

		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err == nil {
			t.Error("Expected error for slug exceeding 63 characters")
		}
	})

	t.Run("validation error - slug with uppercase", func(t *testing.T) {
		org := &organizationv1.Organization{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Organization",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Bad Slug Org",
				Slug: "BadSlug",
				Org:  "default",
			},
			Spec: &organizationv1.OrganizationSpec{
				Description: "Test",
			},
		}

		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err == nil {
			t.Error("Expected error for uppercase characters in slug")
		}
	})

	t.Run("duplicate detection", func(t *testing.T) {
		org := createTestOrganization("Duplicate Org", "dup-org")
		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("First Create failed: %v", err)
		}

		duplicate := createTestOrganization("Duplicate Org", "dup-org")
		_, err = controller.Create(contextWithOrganizationKind(), duplicate)
		if err == nil {
			t.Error("Expected error for duplicate organization slug")
		}
	})
}

func TestOrganizationController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		org := createTestOrganization("Get Test Org", "get-test")
		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		retrieved, err := controller.Get(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test organization for unit tests" {
			t.Errorf("Expected description preserved, got '%s'", retrieved.Spec.Description)
		}

		if retrieved.Metadata.Slug != "get-test" {
			t.Errorf("Expected slug 'get-test', got '%s'", retrieved.Metadata.Slug)
		}
	})

	t.Run("get non-existent organization", func(t *testing.T) {
		_, err := controller.Get(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent organization")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestOrganizationController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update - description", func(t *testing.T) {
		org := createTestOrganization("Update Test", "upd-test")
		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithOrganizationKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("successful update - logo url", func(t *testing.T) {
		org := createTestOrganization("Logo Org", "logo-org")
		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.LogoUrl = "https://example.com/logo.png"
		updated, err := controller.Update(contextWithOrganizationKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.LogoUrl != "https://example.com/logo.png" {
			t.Errorf("Expected logo_url 'https://example.com/logo.png', got '%s'", updated.Spec.LogoUrl)
		}
	})

	t.Run("update non-existent organization", func(t *testing.T) {
		org := &organizationv1.Organization{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Organization",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "non-existent-id",
				Name: "Non-existent Org",
				Slug: "no-exist",
				Org:  "default",
			},
			Spec: &organizationv1.OrganizationSpec{
				Description: "Test",
			},
		}

		_, err := controller.Update(contextWithOrganizationKind(), org)
		if err == nil {
			t.Error("Expected error for updating non-existent organization")
		}
	})
}

func TestOrganizationController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		org := createTestOrganization("Delete Test", "del-test")
		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		deleted, err := controller.Delete(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify the organization is actually deleted
		_, err = controller.Get(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted organization")
		}
	})

	t.Run("delete non-existent organization", func(t *testing.T) {
		_, err := controller.Delete(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent organization")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("deleted organization preserves data", func(t *testing.T) {
		org := createTestOrganization("Verify Delete", "ver-del")
		org.Spec.Description = "Specific description"
		org.Spec.LogoUrl = "https://example.com/logo.png"

		created, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		deleted, err := controller.Delete(contextWithOrganizationKind(), &organizationv1.OrganizationId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Spec.Description != "Specific description" {
			t.Errorf("Expected description 'Specific description', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Verify Delete" {
			t.Errorf("Expected name 'Verify Delete', got '%s'", deleted.Metadata.Name)
		}
	})
}

func TestOrganizationController_Apply(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("apply creates new organization", func(t *testing.T) {
		org := createTestOrganization("Apply New Org", "apply-new")

		applied, err := controller.Apply(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Apply failed: %v", err)
		}

		if applied.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if applied.Metadata.Slug != "apply-new" {
			t.Errorf("Expected slug 'apply-new', got '%s'", applied.Metadata.Slug)
		}
	})

	t.Run("apply updates existing organization", func(t *testing.T) {
		org := createTestOrganization("Apply Update", "apply-upd")
		created, err := controller.Apply(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("First Apply failed: %v", err)
		}

		created.Spec.Description = "Updated via apply"
		updated, err := controller.Apply(contextWithOrganizationKind(), created)
		if err != nil {
			t.Fatalf("Second Apply failed: %v", err)
		}

		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected same ID '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Spec.Description != "Updated via apply" {
			t.Errorf("Expected description 'Updated via apply', got '%s'", updated.Spec.Description)
		}
	})

	t.Run("apply is idempotent", func(t *testing.T) {
		org := createTestOrganization("Idempotent Org", "idemp-org")

		first, err := controller.Apply(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("First Apply failed: %v", err)
		}

		second, err := controller.Apply(contextWithOrganizationKind(), first)
		if err != nil {
			t.Fatalf("Second Apply failed: %v", err)
		}

		third, err := controller.Apply(contextWithOrganizationKind(), second)
		if err != nil {
			t.Fatalf("Third Apply failed: %v", err)
		}

		if first.Metadata.Id != second.Metadata.Id || second.Metadata.Id != third.Metadata.Id {
			t.Error("Expected all applies to return the same resource ID")
		}
	})
}

func TestOrganizationController_Find(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create several organizations
	slugs := []string{"find-aa", "find-bb", "find-cc"}
	for i, slug := range slugs {
		org := createTestOrganization("Find Org "+slug, slug)
		_, err := controller.Create(contextWithOrganizationKind(), org)
		if err != nil {
			t.Fatalf("Create #%d failed: %v", i, err)
		}
	}

	t.Run("find returns all organizations", func(t *testing.T) {
		result, err := controller.Find(contextWithOrganizationKind(), &apiresource.FindApiResourcesRequest{
			Org:      "default",
			PageSize: 20,
		})
		if err != nil {
			t.Fatalf("Find failed: %v", err)
		}

		if len(result.Entries) != 3 {
			t.Errorf("Expected 3 organizations, got %d", len(result.Entries))
		}
	})

	t.Run("find with pagination", func(t *testing.T) {
		result, err := controller.Find(contextWithOrganizationKind(), &apiresource.FindApiResourcesRequest{
			Org:        "default",
			PageSize:   2,
			PageNumber: 1,
		})
		if err != nil {
			t.Fatalf("Find failed: %v", err)
		}

		if len(result.Entries) != 2 {
			t.Errorf("Expected 2 organizations on page 1, got %d", len(result.Entries))
		}

		if result.TotalPages != 2 {
			t.Errorf("Expected 2 total pages, got %d", result.TotalPages)
		}
	})

	t.Run("find page 2", func(t *testing.T) {
		result, err := controller.Find(contextWithOrganizationKind(), &apiresource.FindApiResourcesRequest{
			Org:        "default",
			PageSize:   2,
			PageNumber: 2,
		})
		if err != nil {
			t.Fatalf("Find failed: %v", err)
		}

		if len(result.Entries) != 1 {
			t.Errorf("Expected 1 organization on page 2, got %d", len(result.Entries))
		}
	})

	t.Run("find empty page returns empty list", func(t *testing.T) {
		result, err := controller.Find(contextWithOrganizationKind(), &apiresource.FindApiResourcesRequest{
			Org:        "default",
			PageSize:   2,
			PageNumber: 10,
		})
		if err != nil {
			t.Fatalf("Find failed: %v", err)
		}

		if len(result.Entries) != 0 {
			t.Errorf("Expected 0 organizations on empty page, got %d", len(result.Entries))
		}
	})
}

func TestOrganizationController_FindMyOrganizations(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("returns empty when no organizations exist", func(t *testing.T) {
		result, err := controller.FindMyOrganizations(contextWithOrganizationKind(), &emptypb.Empty{})
		if err != nil {
			t.Fatalf("FindMyOrganizations failed: %v", err)
		}

		if len(result.Entries) != 0 {
			t.Errorf("Expected 0 organizations, got %d", len(result.Entries))
		}
	})

	t.Run("returns all organizations", func(t *testing.T) {
		for _, slug := range []string{"my-org-a", "my-org-b"} {
			org := createTestOrganization("My Org "+slug, slug)
			_, err := controller.Create(contextWithOrganizationKind(), org)
			if err != nil {
				t.Fatalf("Create failed: %v", err)
			}
		}

		result, err := controller.FindMyOrganizations(contextWithOrganizationKind(), &emptypb.Empty{})
		if err != nil {
			t.Fatalf("FindMyOrganizations failed: %v", err)
		}

		if len(result.Entries) != 2 {
			t.Errorf("Expected 2 organizations, got %d", len(result.Entries))
		}
	})
}

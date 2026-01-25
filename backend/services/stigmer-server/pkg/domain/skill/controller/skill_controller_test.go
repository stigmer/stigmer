package skill

import (
	"context"
	"fmt"
	"testing"
	"time"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

// contextWithSkillKind creates a context with the skill resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithSkillKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_skill)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*SkillController, *badger.Store) {
	// Create temporary BadgerDB store
	store, err := badger.NewStore(t.TempDir() + "/badger")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	// Create temporary artifact storage
	artifactStorage, err := storage.NewLocalFileStorage(t.TempDir() + "/artifacts")
	if err != nil {
		t.Fatalf("failed to create artifact storage: %v", err)
	}

	controller := NewSkillController(store, artifactStorage)

	return controller, store
}

// createTestSkill creates a test skill in the store
func createTestSkill(t *testing.T, store *badger.Store, id, slug, tag, hash string) *skillv1.Skill {
	skill := &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Id:   id,
			Slug: slug,
			Name: slug,
		},
		Spec: &skillv1.SkillSpec{
			SkillMd: "# Test Skill\nThis is a test skill.",
			Tag:     tag,
		},
		Status: &skillv1.SkillStatus{
			VersionHash:        hash,
			ArtifactStorageKey: fmt.Sprintf("skills/%s.zip", hash),
			State:              skillv1.SkillState_SKILL_STATE_READY,
		},
	}

	err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_skill, id, skill)
	if err != nil {
		t.Fatalf("failed to save test skill: %v", err)
	}

	return skill
}

// createTestAuditRecord creates a test audit record in the store
func createTestAuditRecord(t *testing.T, store *badger.Store, skillID, tag, hash string, timestamp int64) *skillv1.Skill {
	auditKey := fmt.Sprintf("skill_audit/%s/%d", skillID, timestamp)

	skill := &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Id:   auditKey, // Audit key stored as ID
			Slug: "test-skill",
			Name: "Test Skill",
		},
		Spec: &skillv1.SkillSpec{
			SkillMd: fmt.Sprintf("# Test Skill v%s\nThis is version %s.", tag, tag),
			Tag:     tag,
		},
		Status: &skillv1.SkillStatus{
			VersionHash:        hash,
			ArtifactStorageKey: fmt.Sprintf("skills/%s.zip", hash),
			State:              skillv1.SkillState_SKILL_STATE_READY,
		},
	}

	err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_skill, auditKey, skill)
	if err != nil {
		t.Fatalf("failed to save test audit record: %v", err)
	}

	return skill
}

// Note: Create, Update, and Apply operations have been removed.
// All skill modifications now go through the Push operation.
// Tests for Push are in a separate file or should be added here.

func TestSkillController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("get non-existent skill", func(t *testing.T) {
		_, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent skill")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestSkillController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("delete non-existent skill", func(t *testing.T) {
		_, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent skill")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})
}

func TestSkillController_GetByReference(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create test skill in main collection
	// Hash must be exactly 64 lowercase hex characters (SHA256)
	mainSkill := createTestSkill(t, store, "skill-123", "calculator", "stable", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")

	t.Run("get by slug without version (latest)", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug: "calculator",
			Kind: apiresourcekind.ApiResourceKind_skill,
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Metadata.Id != mainSkill.Metadata.Id {
			t.Errorf("Expected skill ID %s, got %s", mainSkill.Metadata.Id, result.Metadata.Id)
		}
	})

	t.Run("get by slug with explicit latest version", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "calculator",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "latest",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Metadata.Id != mainSkill.Metadata.Id {
			t.Errorf("Expected skill ID %s, got %s", mainSkill.Metadata.Id, result.Metadata.Id)
		}
	})

	t.Run("get by slug with matching tag", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "calculator",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "stable",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Spec.Tag != "stable" {
			t.Errorf("Expected tag 'stable', got '%s'", result.Spec.Tag)
		}
	})

	t.Run("get by slug with matching hash", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "calculator",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Status.VersionHash != "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" {
			t.Errorf("Expected hash match, got '%s'", result.Status.VersionHash)
		}
	})

	t.Run("get non-existent slug", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug: "non-existent",
			Kind: apiresourcekind.ApiResourceKind_skill,
		}

		_, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err == nil {
			t.Error("Expected error for non-existent slug")
		}
	})

	t.Run("get with non-existent version", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "calculator",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "nonexistent-tag",
		}

		_, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err == nil {
			t.Error("Expected error for non-existent version")
		}
	})
}

func TestSkillController_GetByReference_AuditVersions(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create main skill with tag "v3"
	// Hash must be exactly 64 lowercase hex characters (SHA256)
	_ = createTestSkill(t, store, "skill-456", "web-search", "v3", "3333333333333333333333333333333333333333333333333333333333333333")

	// Create audit records for older versions
	now := time.Now().UnixNano()
	createTestAuditRecord(t, store, "skill-456", "v1", "1111111111111111111111111111111111111111111111111111111111111111", now-2000000000) // Oldest
	createTestAuditRecord(t, store, "skill-456", "v2", "2222222222222222222222222222222222222222222222222222222222222222", now-1000000000) // Newer

	t.Run("get current version (v3)", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "web-search",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "v3",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Spec.Tag != "v3" {
			t.Errorf("Expected tag 'v3', got '%s'", result.Spec.Tag)
		}
	})

	t.Run("get older version (v1) from audit", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "web-search",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "v1",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Spec.Tag != "v1" {
			t.Errorf("Expected tag 'v1', got '%s'", result.Spec.Tag)
		}
	})

	t.Run("get version by hash from audit", func(t *testing.T) {
		ref := &apiresourcepb.ApiResourceReference{
			Slug:    "web-search",
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Version: "2222222222222222222222222222222222222222222222222222222222222222",
		}

		result, err := controller.GetByReference(contextWithSkillKind(), ref)
		if err != nil {
			t.Fatalf("Expected no error, got: %v", err)
		}

		if result.Status.VersionHash != "2222222222222222222222222222222222222222222222222222222222222222" {
			t.Errorf("Expected hash match, got '%s'", result.Status.VersionHash)
		}
	})
}

func TestIsHash(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", true},  // Valid 64-char hex
		{"0000000000000000000000000000000000000000000000000000000000000000", true},  // All zeros (64 chars)
		{"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", true},  // All f's (64 chars)
		{"ABCDEF1234567890abcdef1234567890abcdef1234567890ABCDEF1234567890", false}, // Has uppercase (not matching pattern)
		{"abc123", false}, // Too short
		{"stable", false}, // Tag name
		{"v1.0", false},   // Version tag
		{"latest", false}, // Latest
		{"", false},       // Empty
		{"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab", false}, // Too long (66 chars)
		{"ghij001234567890abcdef1234567890abcdef1234567890abcdef1234567890", false},   // Invalid hex chars 'g', 'h', 'i', 'j'
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := isHash(tt.input)
			if result != tt.expected {
				t.Errorf("isHash(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

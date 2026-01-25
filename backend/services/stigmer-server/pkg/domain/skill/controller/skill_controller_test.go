package skill

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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

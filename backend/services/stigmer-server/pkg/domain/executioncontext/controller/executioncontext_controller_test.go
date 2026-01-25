package executioncontext

import (
	"context"
	"testing"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
)

// contextWithExecutionContextKind creates a context with the execution context resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithExecutionContextKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_execution_context)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*ExecutionContextController, store.Store) {
	// Create temporary BadgerDB store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewExecutionContextController(store)

	return controller, store
}

func TestExecutionContextController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with execution_id", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Test Execution Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "test-execution-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"TEST_KEY": {
						Value:    "test-value",
						IsSecret: false,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify defaults set by pipeline
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "test-execution-context" {
			t.Errorf("Expected slug 'test-execution-context', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "ExecutionContext" {
			t.Errorf("Expected kind 'ExecutionContext', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify execution_id is preserved
		if created.Spec.ExecutionId != "test-execution-id" {
			t.Errorf("Expected execution_id 'test-execution-id', got '%s'", created.Spec.ExecutionId)
		}

		// Verify data is preserved
		if len(created.Spec.Data) != 1 {
			t.Errorf("Expected 1 data entry, got %d", len(created.Spec.Data))
		}

		if testVal, ok := created.Spec.Data["TEST_KEY"]; !ok {
			t.Error("Expected TEST_KEY in data")
		} else {
			if testVal.Value != "test-value" {
				t.Errorf("Expected value 'test-value', got '%s'", testVal.Value)
			}
			if testVal.IsSecret != false {
				t.Errorf("Expected is_secret false, got %v", testVal.IsSecret)
			}
		}
	})

	t.Run("successful creation with secret data", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Secret Test Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "test-secret-execution-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"API_KEY": {
						Value:    "secret-api-key-value",
						IsSecret: true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify secret flag is preserved
		if apiKey, ok := created.Spec.Data["API_KEY"]; !ok {
			t.Error("Expected API_KEY in data")
		} else {
			if !apiKey.IsSecret {
				t.Error("Expected is_secret to be true for API_KEY")
			}
		}
	})

	t.Run("validation error - missing execution_id", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				// execution_id is missing
				Data: map[string]*executioncontextv1.ExecutionValue{
					"TEST": {Value: "value", IsSecret: false},
				},
			},
		}

		_, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err == nil {
			t.Error("Expected error when execution_id is not provided")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "test-execution-id",
			},
		}

		_, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "test-execution-id",
			},
		}

		_, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("successful creation with empty data map", func(t *testing.T) {
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Empty Data Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "empty-data-execution-id",
				Data:        map[string]*executioncontextv1.ExecutionValue{},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Empty maps in protobuf are represented as nil - this is standard behavior
		// The map will be initialized when data is added
		if created.Spec.Data != nil && len(created.Spec.Data) != 0 {
			t.Error("Expected empty data map to be nil or have zero length")
		}
	})
}

func TestExecutionContextController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create execution context first
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Get Test Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "get-test-execution-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"CONFIG_KEY": {
						Value:    "config-value",
						IsSecret: false,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the execution context
		retrieved, err := controller.Get(contextWithExecutionContextKind(), &executioncontextv1.ExecutionContextId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.ExecutionId != "get-test-execution-id" {
			t.Errorf("Expected execution_id 'get-test-execution-id', got '%s'", retrieved.Spec.ExecutionId)
		}

		if configVal, ok := retrieved.Spec.Data["CONFIG_KEY"]; !ok {
			t.Error("Expected CONFIG_KEY in data")
		} else {
			if configVal.Value != "config-value" {
				t.Errorf("Expected value 'config-value', got '%s'", configVal.Value)
			}
		}
	})

	t.Run("get non-existent execution context", func(t *testing.T) {
		_, err := controller.Get(contextWithExecutionContextKind(), &executioncontextv1.ExecutionContextId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent execution context")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithExecutionContextKind(), &executioncontextv1.ExecutionContextId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestExecutionContextController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create execution context first
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Test Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "delete-test-execution-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"TEMP_KEY": {
						Value:    "temp-value",
						IsSecret: false,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the execution context
		deleteInput := &apiresource.ApiResourceDeleteInput{
			ResourceId: created.Metadata.Id,
		}
		deleted, err := controller.Delete(contextWithExecutionContextKind(), deleteInput)
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted context ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify execution context is deleted
		_, err = controller.Get(contextWithExecutionContextKind(), &executioncontextv1.ExecutionContextId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted execution context")
		}
	})

	t.Run("delete non-existent execution context", func(t *testing.T) {
		deleteInput := &apiresource.ApiResourceDeleteInput{
			ResourceId: "non-existent-id",
		}
		_, err := controller.Delete(contextWithExecutionContextKind(), deleteInput)
		if err == nil {
			t.Error("Expected error for deleting non-existent execution context")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		deleteInput := &apiresource.ApiResourceDeleteInput{
			ResourceId: "",
		}
		_, err := controller.Delete(contextWithExecutionContextKind(), deleteInput)
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted execution context returns correct data", func(t *testing.T) {
		// Create execution context with specific data
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Delete Verify Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "verify-delete-execution-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"VERIFY_KEY": {
						Value:    "verify-value",
						IsSecret: true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleteInput := &apiresource.ApiResourceDeleteInput{
			ResourceId: created.Metadata.Id,
		}
		deleted, err := controller.Delete(contextWithExecutionContextKind(), deleteInput)
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.ExecutionId != "verify-delete-execution-id" {
			t.Errorf("Expected execution_id 'verify-delete-execution-id', got '%s'", deleted.Spec.ExecutionId)
		}

		if verifyVal, ok := deleted.Spec.Data["VERIFY_KEY"]; !ok {
			t.Error("Expected VERIFY_KEY in deleted data")
		} else {
			if verifyVal.Value != "verify-value" {
				t.Errorf("Expected value 'verify-value', got '%s'", verifyVal.Value)
			}
			if !verifyVal.IsSecret {
				t.Error("Expected is_secret to be true")
			}
		}

		if deleted.Metadata.Name != "Delete Verify Context" {
			t.Errorf("Expected name 'Delete Verify Context', got '%s'", deleted.Metadata.Name)
		}
	})

	t.Run("verify secret data persists through lifecycle", func(t *testing.T) {
		// Create with mixed secret and non-secret data
		execContext := &executioncontextv1.ExecutionContext{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "ExecutionContext",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Secret Lifecycle Context",
				OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
			},
			Spec: &executioncontextv1.ExecutionContextSpec{
				ExecutionId: "secret-lifecycle-id",
				Data: map[string]*executioncontextv1.ExecutionValue{
					"PUBLIC_CONFIG": {
						Value:    "public-value",
						IsSecret: false,
					},
					"SECRET_TOKEN": {
						Value:    "super-secret-token",
						IsSecret: true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithExecutionContextKind(), execContext)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Retrieve and verify
		retrieved, err := controller.Get(contextWithExecutionContextKind(), &executioncontextv1.ExecutionContextId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if len(retrieved.Spec.Data) != 2 {
			t.Errorf("Expected 2 data entries, got %d", len(retrieved.Spec.Data))
		}

		if pubVal, ok := retrieved.Spec.Data["PUBLIC_CONFIG"]; !ok {
			t.Error("Expected PUBLIC_CONFIG in data")
		} else if pubVal.IsSecret {
			t.Error("Expected PUBLIC_CONFIG to not be secret")
		}

		if secVal, ok := retrieved.Spec.Data["SECRET_TOKEN"]; !ok {
			t.Error("Expected SECRET_TOKEN in data")
		} else if !secVal.IsSecret {
			t.Error("Expected SECRET_TOKEN to be secret")
		}

		// Delete and verify data is still correct
		deleteInput := &apiresource.ApiResourceDeleteInput{
			ResourceId: created.Metadata.Id,
		}
		deleted, err := controller.Delete(contextWithExecutionContextKind(), deleteInput)
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if len(deleted.Spec.Data) != 2 {
			t.Errorf("Expected 2 data entries in deleted context, got %d", len(deleted.Spec.Data))
		}
	})
}

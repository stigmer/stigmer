package environment

import (
	"context"
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// contextWithEnvironmentKind creates a context with the environment resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithEnvironmentKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_environment)
}

// setupTestController creates a test controller with necessary dependencies
func setupTestController(t *testing.T) (*EnvironmentController, store.Store) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	secretService, _ := encryption.NewSecretService(nil)
	controller := NewEnvironmentController(store, secretService)

	return controller, store
}

func TestEnvironmentController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with data", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test environment description",
				Data: map[string]*environmentv1.EnvironmentValue{
					"AWS_REGION": {
						Value:       "us-west-2",
						IsSecret:    false,
						Description: "AWS region for deployments",
					},
					"AWS_ACCESS_KEY_ID": {
						Value:       "AKIA1234567890ABCDEF",
						IsSecret:    true,
						Description: "AWS access key",
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
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

		if created.Metadata.Slug != "test-environment" {
			t.Errorf("Expected slug 'test-environment', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Environment" {
			t.Errorf("Expected kind 'Environment', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test environment description" {
			t.Errorf("Expected description 'Test environment description', got '%s'", created.Spec.Description)
		}

		// Verify data is preserved
		if len(created.Spec.Data) != 2 {
			t.Errorf("Expected 2 data entries, got %d", len(created.Spec.Data))
		}

		if created.Spec.Data["AWS_REGION"].Value != "us-west-2" {
			t.Errorf("Expected AWS_REGION 'us-west-2', got '%s'", created.Spec.Data["AWS_REGION"].Value)
		}

		if created.Spec.Data["AWS_REGION"].IsSecret {
			t.Error("Expected AWS_REGION to not be secret")
		}

		if created.Spec.Data["AWS_ACCESS_KEY_ID"].Value != "AKIA1234567890ABCDEF" {
			t.Errorf("Expected AWS_ACCESS_KEY_ID 'AKIA1234567890ABCDEF', got '%s'", created.Spec.Data["AWS_ACCESS_KEY_ID"].Value)
		}

		if !created.Spec.Data["AWS_ACCESS_KEY_ID"].IsSecret {
			t.Error("Expected AWS_ACCESS_KEY_ID to be secret")
		}
	})

	t.Run("successful creation with empty data", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Empty Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Environment with no data",
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Spec.Description != "Environment with no data" {
			t.Errorf("Expected description 'Environment with no data', got '%s'", created.Spec.Description)
		}

		// Data map can be nil when not initialized (protobuf behavior)
		// Just verify it's empty (nil or len 0)
		if len(created.Spec.Data) != 0 {
			t.Errorf("Expected empty data map, got %d entries", len(created.Spec.Data))
		}
	})

	t.Run("validation error - missing metadata", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("validation error - missing name", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("successful creation with empty environment value", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Empty Value Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Environment with empty value",
				Data: map[string]*environmentv1.EnvironmentValue{
					"EMPTY_VALUE": {
						Value:    "", // Empty values are allowed per proto spec comments
						IsSecret: false,
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Spec.Data["EMPTY_VALUE"].Value != "" {
			t.Error("Expected empty value to be preserved")
		}
	})
}

// newEnvWithData is a fixture helper for the secret-sentinel tests below.
func newEnvWithData(name string, data map[string]*environmentv1.EnvironmentValue) *environmentv1.Environment {
	return &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &environmentv1.EnvironmentSpec{Data: data},
	}
}

// TestEnvironmentController_SecretSentinels pins the oss#395 write-boundary
// contract across all three environment write pipelines. The harness runs
// KEYLESS (NewSecretService(nil)), so passing here also proves the
// rejection is unconditional — not gated on encryption being enabled.
func TestEnvironmentController_SecretSentinels(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	ctx := contextWithEnvironmentKind()

	t.Run("create rejects ciphertext-shaped secret", func(t *testing.T) {
		env := newEnvWithData("Smuggle Create", map[string]*environmentv1.EnvironmentValue{
			"API_KEY": {Value: "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=", IsSecret: true},
		})
		if _, err := controller.Create(ctx, env); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", err)
		}
	})

	t.Run("create rejects the redaction marker", func(t *testing.T) {
		env := newEnvWithData("Marker Create", map[string]*environmentv1.EnvironmentValue{
			"API_KEY": {Value: envsteps.RedactedMarker, IsSecret: true},
		})
		if _, err := controller.Create(ctx, env); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument (nothing to preserve on create), got %v", err)
		}
	})

	t.Run("create accepts a non-secret value that merely looks prefixed", func(t *testing.T) {
		// Deliberate exemption: every decrypt path gates on is_secret, so a
		// non-secret prefixed string is inert; flipping it to secret later
		// re-enters the guard.
		env := newEnvWithData("Inert Create", map[string]*environmentv1.EnvironmentValue{
			"DOCS_EXAMPLE": {Value: "enc:v1:just-an-example", IsSecret: false},
		})
		if _, err := controller.Create(ctx, env); err != nil {
			t.Fatalf("non-secret prefixed value must be accepted, got %v", err)
		}
	})

	t.Run("update rejects ciphertext-shaped secret", func(t *testing.T) {
		created, err := controller.Create(ctx, newEnvWithData("Smuggle Update",
			map[string]*environmentv1.EnvironmentValue{
				"API_KEY": {Value: "real-secret", IsSecret: true},
			}))
		if err != nil {
			t.Fatalf("create failed: %v", err)
		}

		created.Spec.Data["API_KEY"] = &environmentv1.EnvironmentValue{
			Value: "enc:v2:ZnV0dXJlLXZlcnNpb24=", IsSecret: true}
		if _, err := controller.Update(ctx, created); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", err)
		}
	})

	t.Run("update marker still preserves the stored secret", func(t *testing.T) {
		// Arm-ordering pin: the marker arm restores the STORED value and
		// must run before the prefix rejection ever sees it.
		created, err := controller.Create(ctx, newEnvWithData("Marker Update",
			map[string]*environmentv1.EnvironmentValue{
				"API_KEY": {Value: "original-secret", IsSecret: true},
			}))
		if err != nil {
			t.Fatalf("create failed: %v", err)
		}

		created.Spec.Data["API_KEY"] = &environmentv1.EnvironmentValue{
			Value: envsteps.RedactedMarker, IsSecret: true}
		updated, err := controller.Update(ctx, created)
		if err != nil {
			t.Fatalf("marker update failed: %v", err)
		}
		if updated.Spec.Data["API_KEY"].GetValue() != "original-secret" {
			t.Errorf("marker must preserve the stored secret, got %q",
				updated.Spec.Data["API_KEY"].GetValue())
		}
	})

	t.Run("updateVariables rejects ciphertext-shaped secret", func(t *testing.T) {
		created, err := controller.Create(ctx, newEnvWithData("Smuggle Merge",
			map[string]*environmentv1.EnvironmentValue{
				"EXISTING": {Value: "keep-me", IsSecret: false},
			}))
		if err != nil {
			t.Fatalf("create failed: %v", err)
		}

		_, err = controller.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
			EnvironmentId: created.GetMetadata().GetId(),
			Variables: map[string]*environmentv1.EnvironmentValue{
				"API_KEY": {Value: "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=", IsSecret: true},
			},
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", err)
		}
	})

	t.Run("updateVariables accepts a non-secret prefixed value", func(t *testing.T) {
		created, err := controller.Create(ctx, newEnvWithData("Inert Merge",
			map[string]*environmentv1.EnvironmentValue{
				"EXISTING": {Value: "keep-me", IsSecret: false},
			}))
		if err != nil {
			t.Fatalf("create failed: %v", err)
		}

		if _, err := controller.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
			EnvironmentId: created.GetMetadata().GetId(),
			Variables: map[string]*environmentv1.EnvironmentValue{
				"DOCS_EXAMPLE": {Value: "enc:v1:just-an-example", IsSecret: false},
			},
		}); err != nil {
			t.Fatalf("non-secret prefixed value must be accepted, got %v", err)
		}
	})
}

func TestEnvironmentController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create environment first
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Get Test Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
				Data: map[string]*environmentv1.EnvironmentValue{
					"TEST_KEY": {
						Value:       "test-value",
						IsSecret:    false,
						Description: "Test key description",
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the environment
		retrieved, err := controller.Get(contextWithEnvironmentKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test description" {
			t.Errorf("Expected description 'Test description', got '%s'", retrieved.Spec.Description)
		}

		if len(retrieved.Spec.Data) != 1 {
			t.Errorf("Expected 1 data entry, got %d", len(retrieved.Spec.Data))
		}

		if retrieved.Spec.Data["TEST_KEY"].Value != "test-value" {
			t.Errorf("Expected TEST_KEY 'test-value', got '%s'", retrieved.Spec.Data["TEST_KEY"].Value)
		}
	})

	t.Run("get non-existent environment", func(t *testing.T) {
		_, err := controller.Get(contextWithEnvironmentKind(), &apiresource.ApiResourceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent environment")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithEnvironmentKind(), &apiresource.ApiResourceId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestEnvironmentController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update - description", func(t *testing.T) {
		// Create environment first
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Update Test Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Original description",
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the description
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithEnvironmentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("successful update - add data", func(t *testing.T) {
		// Create environment first
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Update Data Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
				Data: map[string]*environmentv1.EnvironmentValue{
					"KEY1": {
						Value:    "value1",
						IsSecret: false,
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Add new data
		created.Spec.Data["KEY2"] = &environmentv1.EnvironmentValue{
			Value:    "value2",
			IsSecret: true,
		}
		updated, err := controller.Update(contextWithEnvironmentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if len(updated.Spec.Data) != 2 {
			t.Errorf("Expected 2 data entries, got %d", len(updated.Spec.Data))
		}

		if updated.Spec.Data["KEY1"].Value != "value1" {
			t.Errorf("Expected KEY1 'value1', got '%s'", updated.Spec.Data["KEY1"].Value)
		}

		if updated.Spec.Data["KEY2"].Value != "value2" {
			t.Errorf("Expected KEY2 'value2', got '%s'", updated.Spec.Data["KEY2"].Value)
		}

		if !updated.Spec.Data["KEY2"].IsSecret {
			t.Error("Expected KEY2 to be secret")
		}
	})

	t.Run("successful update - modify existing data", func(t *testing.T) {
		// Create environment first
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Modify Data Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
				Data: map[string]*environmentv1.EnvironmentValue{
					"API_KEY": {
						Value:    "old-key",
						IsSecret: true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Modify existing data
		created.Spec.Data["API_KEY"].Value = "new-key"
		updated, err := controller.Update(contextWithEnvironmentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Data["API_KEY"].Value != "new-key" {
			t.Errorf("Expected API_KEY 'new-key', got '%s'", updated.Spec.Data["API_KEY"].Value)
		}

		if !updated.Spec.Data["API_KEY"].IsSecret {
			t.Error("Expected API_KEY to remain secret")
		}
	})

	t.Run("update non-existent environment", func(t *testing.T) {
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "non-existent-id",
				Name: "Non-existent Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
			},
		}

		_, err := controller.Update(contextWithEnvironmentKind(), environment)
		if err == nil {
			t.Error("Expected error for updating non-existent environment")
		}
	})
}

func TestEnvironmentController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create environment first
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Delete Test Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Test description",
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the environment
		deleted, err := controller.Delete(contextWithEnvironmentKind(), &apiresource.ApiResourceDeleteInput{ResourceId: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted environment ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify environment is deleted
		_, err = controller.Get(contextWithEnvironmentKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted environment")
		}
	})

	t.Run("delete non-existent environment", func(t *testing.T) {
		_, err := controller.Delete(contextWithEnvironmentKind(), &apiresource.ApiResourceDeleteInput{ResourceId: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent environment")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithEnvironmentKind(), &apiresource.ApiResourceDeleteInput{ResourceId: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted environment returns correct data", func(t *testing.T) {
		// Create environment with specific data
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Delete Verify Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Verify deletion data",
				Data: map[string]*environmentv1.EnvironmentValue{
					"VERIFY_KEY": {
						Value:       "verify-value",
						IsSecret:    false,
						Description: "Verification key",
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithEnvironmentKind(), &apiresource.ApiResourceDeleteInput{ResourceId: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.Description != "Verify deletion data" {
			t.Errorf("Expected description 'Verify deletion data', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Environment" {
			t.Errorf("Expected name 'Delete Verify Environment', got '%s'", deleted.Metadata.Name)
		}

		if len(deleted.Spec.Data) != 1 {
			t.Errorf("Expected 1 data entry, got %d", len(deleted.Spec.Data))
		}

		if deleted.Spec.Data["VERIFY_KEY"].Value != "verify-value" {
			t.Errorf("Expected VERIFY_KEY 'verify-value', got '%s'", deleted.Spec.Data["VERIFY_KEY"].Value)
		}
	})

	t.Run("delete environment with secrets", func(t *testing.T) {
		// Create environment with secrets
		environment := &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Secret Environment",
				Org:  "test-org",
			},
			Spec: &environmentv1.EnvironmentSpec{
				Description: "Environment with secrets",
				Data: map[string]*environmentv1.EnvironmentValue{
					"PUBLIC_KEY": {
						Value:    "public-value",
						IsSecret: false,
					},
					"SECRET_KEY": {
						Value:    "secret-value",
						IsSecret: true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithEnvironmentKind(), environment)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify secrets are preserved
		deleted, err := controller.Delete(contextWithEnvironmentKind(), &apiresource.ApiResourceDeleteInput{ResourceId: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Spec.Data["SECRET_KEY"].Value != "secret-value" {
			t.Errorf("Expected SECRET_KEY 'secret-value', got '%s'", deleted.Spec.Data["SECRET_KEY"].Value)
		}

		if !deleted.Spec.Data["SECRET_KEY"].IsSecret {
			t.Error("Expected SECRET_KEY to be marked as secret")
		}

		if deleted.Spec.Data["PUBLIC_KEY"].Value != "public-value" {
			t.Errorf("Expected PUBLIC_KEY 'public-value', got '%s'", deleted.Spec.Data["PUBLIC_KEY"].Value)
		}

		if deleted.Spec.Data["PUBLIC_KEY"].IsSecret {
			t.Error("Expected PUBLIC_KEY to not be marked as secret")
		}
	})
}

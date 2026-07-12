package environment

import (
	"context"
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// createTestEnvironment persists an environment through the real create
// pipeline and returns it. Labels may be nil.
func createTestEnvironment(t *testing.T, controller *EnvironmentController, name string, labels map[string]string) *environmentv1.Environment {
	t.Helper()
	env := &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:   name,
			Org:    "test-org",
			Labels: labels,
		},
		Spec: &environmentv1.EnvironmentSpec{
			Data: map[string]*environmentv1.EnvironmentValue{
				"API_KEY": {Value: "secret-value", IsSecret: true},
			},
		},
	}
	created, err := controller.Create(contextWithEnvironmentKind(), env)
	require.NoError(t, err, "test environment %q should create", name)
	return created
}

func TestEnvironmentController_UpdateVisibility_PrivateToOrg(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	created := createTestEnvironment(t, controller, "shareable-env", nil)
	require.NotEqual(t, apiresource.ApiResourceVisibility_visibility_org,
		created.GetMetadata().GetVisibility(),
		"environments must not default to org visibility - sharing is an explicit opt-in")

	updated, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err, "private -> org should succeed")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_org, updated.GetMetadata().GetVisibility())

	// Verify persistence, not just the response.
	stored := &environmentv1.Environment{}
	require.NoError(t, s.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, created.GetMetadata().GetId(), stored))
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_org, stored.GetMetadata().GetVisibility(),
		"org visibility must be persisted")
	assert.Equal(t, created.GetSpec().GetData()["API_KEY"].GetValue(), stored.GetSpec().GetData()["API_KEY"].GetValue(),
		"visibility update must not touch spec data")
}

func TestEnvironmentController_UpdateVisibility_OrgToPrivate_Revocation(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	created := createTestEnvironment(t, controller, "revocable-env", nil)

	_, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err)

	reverted, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err, "org -> private (revocation) should always succeed")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_private, reverted.GetMetadata().GetVisibility())
}

func TestEnvironmentController_UpdateVisibility_RejectsPublicAndPlatform(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	created := createTestEnvironment(t, controller, "no-public-env", nil)

	for _, level := range []apiresource.ApiResourceVisibility{
		apiresource.ApiResourceVisibility_visibility_public,
		apiresource.ApiResourceVisibility_visibility_platform,
	} {
		_, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
			ResourceId: created.GetMetadata().GetId(),
			Visibility: level,
		})
		require.Error(t, err, "level %s must be rejected for environments", level)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.InvalidArgument, st.Code(),
			"level %s should be INVALID_ARGUMENT, got %s: %s", level, st.Code(), st.Message())
		assert.Contains(t, st.Message(), "not supported for environments")
	}

	// The rejected attempts must not have changed the stored visibility.
	stored := &environmentv1.Environment{}
	require.NoError(t, s.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, created.GetMetadata().GetId(), stored))
	assert.NotEqual(t, apiresource.ApiResourceVisibility_visibility_public, stored.GetMetadata().GetVisibility())
	assert.NotEqual(t, apiresource.ApiResourceVisibility_visibility_platform, stored.GetMetadata().GetVisibility())
}

func TestEnvironmentController_UpdateVisibility_RejectsPersonalEnvironment(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	created := createTestEnvironment(t, controller, "my-personal-env",
		map[string]string{"stigmer.ai/personal": "true"})

	_, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.Error(t, err, "personal environments must never be org-shareable")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Contains(t, st.Message(), "personal environments cannot be shared")
}

func TestEnvironmentController_UpdateVisibility_RejectsManagedEnvironment(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	created := createTestEnvironment(t, controller, "oauth-slack-env",
		map[string]string{"stigmer.ai/managed": "true"})

	_, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.Error(t, err, "OAuth-managed environments must never be org-shareable")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Contains(t, st.Message(), "OAuth-managed environments cannot be shared")
}

func TestEnvironmentController_UpdateVisibility_ShareRestrictedCanReturnToPrivate(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// A share-restricted environment that somehow carries org visibility
	// (e.g. written by an older build) must always be restorable to private:
	// the guardrail gates only widening transitions, never fail-closing.
	created := createTestEnvironment(t, controller, "stranded-personal-env",
		map[string]string{"stigmer.ai/personal": "true"})
	created.Metadata.Visibility = apiresource.ApiResourceVisibility_visibility_org
	require.NoError(t, s.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, created.GetMetadata().GetId(), created))

	reverted, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err, "restoring a share-restricted environment to private must succeed")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_private, reverted.GetMetadata().GetVisibility())
}

func TestEnvironmentController_UpdateVisibility_NotFound(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	_, err := controller.UpdateVisibility(contextWithEnvironmentKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: "env_does_not_exist",
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

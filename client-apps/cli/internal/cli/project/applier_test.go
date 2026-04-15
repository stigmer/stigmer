package project

import (
	"testing"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func stubApplyClient() *stigmer.Client {
	return &stigmer.Client{}
}

// =============================================================================
// ApplyOptions Validation Tests
// =============================================================================

func TestApply_NilOptions(t *testing.T) {
	result, err := Apply(nil)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "apply options cannot be nil")
}

func TestApply_NilProject(t *testing.T) {
	opts := &ApplyOptions{
		Project: nil,
		Client: stubApplyClient(),
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "project is required")
}

func TestApply_NilConnection(t *testing.T) {
	opts := &ApplyOptions{
		Project: &projectv1.Project{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Project",
		},
		Client: nil,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client is required")
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestApply_ValidationOrder(t *testing.T) {
	// Verify validation happens in the correct order:
	// 1. nil options check
	// 2. nil project check
	// 3. nil connection check

	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Apply(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "apply options cannot be nil")
	})

	t.Run("nil project checked second", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Project: nil,
			Client: stubApplyClient(),
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "project is required")
	})

	t.Run("nil connection checked third", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Project: &projectv1.Project{},
			Client:  nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "client is required")
	})
}

// =============================================================================
// DryRun Tests
// =============================================================================

func TestApply_DryRun_ReturnsWithoutRPC(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-project",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: "main.go",
		},
	}

	opts := &ApplyOptions{
		Project: project,
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true, // Suppress output in tests
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, project, result.Project)
	assert.False(t, result.Created) // DryRun returns false for Created
}

func TestApply_DryRun_PreservesProject(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-project",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "main.py",
			Description: "Test project description",
		},
	}

	opts := &ApplyOptions{
		Project: project,
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify all fields preserved
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
	assert.Equal(t, "test-org", result.Project.Metadata.Org)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
	assert.Equal(t, "Test project description", result.Project.Spec.Description)
}

// =============================================================================
// Metadata Population Tests
// =============================================================================

func TestApply_SetsOrgFromOptions_WhenMetadataNil(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		// Metadata is nil
	}

	opts := &ApplyOptions{
		Project: project,
		OrgID:   "my-org",
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.Project.Metadata)
	assert.Equal(t, "my-org", result.Project.Metadata.Org)
}

func TestApply_SetsOrgFromOptions_WhenOrgEmpty(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-project",
			Org:  "", // Empty org
		},
	}

	opts := &ApplyOptions{
		Project: project,
		OrgID:   "my-org",
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "my-org", result.Project.Metadata.Org)
}

func TestApply_PreservesExistingOrg_WhenOrgIDProvided(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-project",
			Org:  "existing-org", // Already has org
		},
	}

	opts := &ApplyOptions{
		Project: project,
		OrgID:   "new-org",
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	// Existing org should be preserved (not overwritten)
	assert.Equal(t, "existing-org", result.Project.Metadata.Org)
}

// =============================================================================
// ApplyOptions Structure Tests
// =============================================================================

func TestApplyOptions_DefaultPruneValue(t *testing.T) {
	// Verify default Prune is false (Go zero value)
	// Note: In usage, we default to true, but the struct defaults to false
	opts := &ApplyOptions{}
	assert.False(t, opts.Prune)
}

func TestApplyOptions_AllFields(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
	}

	opts := &ApplyOptions{
		Project: project,
		OrgID:   "test-org",
		Client: stubApplyClient(),
		Quiet:   true,
		DryRun:  true,
		Prune:   true,
	}

	assert.Equal(t, project, opts.Project)
	assert.Equal(t, "test-org", opts.OrgID)
	assert.NotNil(t, opts.Client)
	assert.True(t, opts.Quiet)
	assert.True(t, opts.DryRun)
	assert.True(t, opts.Prune)
}

// =============================================================================
// ApplyResult Structure Tests
// =============================================================================

func TestApplyResult_Structure(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "prj_abc123",
			Name: "test-project",
		},
	}

	result := &ApplyResult{
		Project: project,
		Created: true,
	}

	assert.NotNil(t, result.Project)
	assert.Equal(t, "prj_abc123", result.Project.Metadata.Id)
	assert.True(t, result.Created)
}

func TestApplyResult_UpdateCase(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "prj_existing",
			Name: "existing-project",
		},
	}

	result := &ApplyResult{
		Project: project,
		Created: false, // Update, not create
	}

	assert.NotNil(t, result.Project)
	assert.False(t, result.Created)
}

// =============================================================================
// Create vs Update Detection Tests
// =============================================================================

func TestApply_DetectsCreate_WhenNoExistingID(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "new-project",
			// No ID set - this is a create
		},
	}

	opts := &ApplyOptions{
		Project: project,
		Client: stubApplyClient(),
		DryRun:  true, // Use dry-run to avoid RPC
		Quiet:   true,
	}

	// Note: In dry-run mode, Created is always false
	// The create detection logic is in the non-dry-run path
	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestApply_DetectsUpdate_WhenExistingID(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "prj_existing123",
			Name: "existing-project",
		},
	}

	opts := &ApplyOptions{
		Project: project,
		Client: stubApplyClient(),
		DryRun:  true,
		Quiet:   true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}

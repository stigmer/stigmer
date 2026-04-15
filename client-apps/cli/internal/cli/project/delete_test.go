package project

import (
	"testing"

	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// =============================================================================
// Mock gRPC Connection
// =============================================================================

// mockConn implements grpc.ClientConnInterface for testing.
// This allows us to test validation logic without a real gRPC connection.
type mockConn struct {
	grpc.ClientConnInterface
}

// =============================================================================
// DeleteOptions Validation Tests
// =============================================================================

func TestDelete_NilOptions(t *testing.T) {
	result, err := Delete(nil)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "delete options cannot be nil")
}

func TestDelete_NilConnection(t *testing.T) {
	opts := &DeleteOptions{
		ProjectID: "prj_abc123",
		Conn:      nil,
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
}

func TestDelete_EmptyProjectID(t *testing.T) {
	opts := &DeleteOptions{
		ProjectID: "",
		Conn:      &mockConn{},
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "project ID cannot be empty")
}

// =============================================================================
// DeleteFromBackend Validation Tests
// =============================================================================

func TestDeleteFromBackend_EmptyProjectID(t *testing.T) {
	conn := &mockConn{}

	result, err := DeleteFromBackend(conn, "")

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "project ID is required for delete operation")
}

// =============================================================================
// DeleteResult Structure Tests
// =============================================================================

func TestDeleteResult_Structure(t *testing.T) {
	// Verify DeleteResult correctly wraps a Project
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
	}

	result := &DeleteResult{
		Project: project,
	}

	assert.NotNil(t, result.Project)
	assert.Equal(t, "tenancy.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
}

func TestDeleteResult_NilProject(t *testing.T) {
	// DeleteResult can hold nil project (edge case)
	result := &DeleteResult{
		Project: nil,
	}

	assert.Nil(t, result.Project)
}

// =============================================================================
// DeleteOptions Structure Tests
// =============================================================================

func TestDeleteOptions_ValidStructure(t *testing.T) {
	conn := &mockConn{}
	opts := &DeleteOptions{
		ProjectID: "prj_abc123",
		Conn:      conn,
	}

	assert.Equal(t, "prj_abc123", opts.ProjectID)
	assert.NotNil(t, opts.Conn)
}

func TestDeleteOptions_ProjectIDFormats(t *testing.T) {
	// Test various valid project ID formats
	testCases := []struct {
		name      string
		projectID string
	}{
		{
			name:      "underscore separator",
			projectID: "prj_abc123",
		},
		{
			name:      "hyphen separator",
			projectID: "prj-abc123",
		},
		{
			name:      "long ID",
			projectID: "prj_01kewqjbtdy0w4d14bnhhy4yc2",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			opts := &DeleteOptions{
				ProjectID: tc.projectID,
				Conn:      &mockConn{},
			}
			assert.Equal(t, tc.projectID, opts.ProjectID)
		})
	}
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestDelete_ValidationOrder(t *testing.T) {
	// Verify validation happens in the correct order:
	// 1. nil options check
	// 2. nil connection check
	// 3. empty project ID check

	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Delete(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "delete options cannot be nil")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			ProjectID: "prj_abc123",
			Conn:      nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
	})

	t.Run("empty project ID checked third", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			ProjectID: "",
			Conn:      &mockConn{},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "project ID cannot be empty")
	})
}

package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
		WorkflowID: testWorkflowID,
		Conn:       nil,
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
}

func TestDelete_EmptyWorkflowID(t *testing.T) {
	opts := &DeleteOptions{
		WorkflowID: "",
		Conn:       &mockConn{},
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "workflow ID cannot be empty")
}

// =============================================================================
// DeleteFromBackend Validation Tests
// =============================================================================

func TestDeleteFromBackend_EmptyWorkflowID(t *testing.T) {
	conn := &mockConn{}

	result, err := DeleteFromBackend(conn, "")

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "workflow ID is required for delete operation")
}

// =============================================================================
// DeleteResult Structure Tests
// =============================================================================

func TestDeleteResult_Structure(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
		},
	}

	result := &DeleteResult{
		Workflow: workflow,
	}

	assert.NotNil(t, result.Workflow)
	assert.Equal(t, testWorkflowID, result.Workflow.Metadata.Id)
	assert.Equal(t, testWorkflowName, result.Workflow.Metadata.Name)
	assert.Equal(t, testWorkflowSlug, result.Workflow.Metadata.Slug)
}

func TestDeleteResult_NilWorkflow(t *testing.T) {
	// DeleteResult can hold nil workflow (edge case)
	result := &DeleteResult{
		Workflow: nil,
	}

	assert.Nil(t, result.Workflow)
}

// =============================================================================
// DeleteOptions Structure Tests
// =============================================================================

func TestDeleteOptions_ValidStructure(t *testing.T) {
	conn := &mockConn{}
	opts := &DeleteOptions{
		WorkflowID: testWorkflowID,
		Conn:       conn,
	}

	assert.Equal(t, testWorkflowID, opts.WorkflowID)
	assert.NotNil(t, opts.Conn)
}

func TestDeleteOptions_DefaultValues(t *testing.T) {
	opts := &DeleteOptions{}

	assert.Equal(t, "", opts.WorkflowID)
	assert.Nil(t, opts.Conn)
}

func TestDeleteOptions_WorkflowIDFormats(t *testing.T) {
	// Test various valid workflow ID formats
	testCases := []struct {
		name       string
		workflowID string
	}{
		{
			name:       "underscore separator",
			workflowID: "wfl_abc123",
		},
		{
			name:       "hyphen separator",
			workflowID: "wfl-abc123",
		},
		{
			name:       "long ID",
			workflowID: "wfl_01kewqjbtdy0w4d14bnhhy4yc2",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			opts := &DeleteOptions{
				WorkflowID: tc.workflowID,
				Conn:       &mockConn{},
			}
			assert.Equal(t, tc.workflowID, opts.WorkflowID)
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
	// 3. empty workflow ID check

	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Delete(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "delete options cannot be nil")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			WorkflowID: testWorkflowID,
			Conn:       nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
	})

	t.Run("empty workflow ID checked third", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			WorkflowID: "",
			Conn:       &mockConn{},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "workflow ID cannot be empty")
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDeleteOptions_WhitespaceWorkflowID_Structure(t *testing.T) {
	// Whitespace-only ID is technically not empty per validation
	// This tests that the options struct accepts it
	opts := &DeleteOptions{
		WorkflowID: "   ",
		Conn:       &mockConn{},
	}

	// Verify the struct is created correctly
	assert.Equal(t, "   ", opts.WorkflowID)
	assert.NotNil(t, opts.Conn)
	// Note: The actual RPC call would fail with whitespace ID
	// but validation only checks for empty string
}

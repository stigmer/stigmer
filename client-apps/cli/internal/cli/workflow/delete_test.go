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

func TestDelete_NilClient(t *testing.T) {
	opts := &DeleteOptions{
		WorkflowID: testWorkflowID,
		Client:     nil,
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client cannot be nil")
}

func TestDelete_EmptyWorkflowID(t *testing.T) {
	opts := &DeleteOptions{
		WorkflowID: "",
		Client:     stubClient(),
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
	result, err := DeleteFromBackend(stubClient(), "")

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "workflow ID is required for delete operation")
}

// =============================================================================
// DeleteResult Structure Tests
// =============================================================================

func TestDeleteResult_Structure(t *testing.T) {
	w := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
		},
	}

	result := &DeleteResult{Workflow: w}

	assert.NotNil(t, result.Workflow)
	assert.Equal(t, testWorkflowID, result.Workflow.Metadata.Id)
	assert.Equal(t, testWorkflowName, result.Workflow.Metadata.Name)
	assert.Equal(t, testWorkflowSlug, result.Workflow.Metadata.Slug)
}

func TestDeleteResult_NilWorkflow(t *testing.T) {
	result := &DeleteResult{Workflow: nil}
	assert.Nil(t, result.Workflow)
}

// =============================================================================
// DeleteOptions Structure Tests
// =============================================================================

func TestDeleteOptions_ValidStructure(t *testing.T) {
	c := stubClient()
	opts := &DeleteOptions{
		WorkflowID: testWorkflowID,
		Client:     c,
	}

	assert.Equal(t, testWorkflowID, opts.WorkflowID)
	assert.NotNil(t, opts.Client)
}

func TestDeleteOptions_DefaultValues(t *testing.T) {
	opts := &DeleteOptions{}

	assert.Equal(t, "", opts.WorkflowID)
	assert.Nil(t, opts.Client)
}

func TestDeleteOptions_WorkflowIDFormats(t *testing.T) {
	testCases := []struct {
		name       string
		workflowID string
	}{
		{name: "underscore separator", workflowID: "wfl_abc123"},
		{name: "hyphen separator", workflowID: "wfl-abc123"},
		{name: "long ID", workflowID: "wfl_01kewqjbtdy0w4d14bnhhy4yc2"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			opts := &DeleteOptions{
				WorkflowID: tc.workflowID,
				Client:     stubClient(),
			}
			assert.Equal(t, tc.workflowID, opts.WorkflowID)
		})
	}
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestDelete_ValidationOrder(t *testing.T) {
	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Delete(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "delete options cannot be nil")
	})

	t.Run("nil client checked second", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			WorkflowID: testWorkflowID,
			Client:     nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "client cannot be nil")
	})

	t.Run("empty workflow ID checked third", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			WorkflowID: "",
			Client:     stubClient(),
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "workflow ID cannot be empty")
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDeleteOptions_WhitespaceWorkflowID_Structure(t *testing.T) {
	opts := &DeleteOptions{
		WorkflowID: "   ",
		Client:     stubClient(),
	}

	assert.Equal(t, "   ", opts.WorkflowID)
	assert.NotNil(t, opts.Client)
}

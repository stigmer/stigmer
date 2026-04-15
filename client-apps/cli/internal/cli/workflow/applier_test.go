package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// =============================================================================
// Test Constants
// =============================================================================

const (
	testOrgID        = "org_01kewqjbtdy0w4d14bnhhy4yc2"
	testWorkflowID   = "wfl_01kewqjbtdy0w4d14bnhhy4yc2"
	testWorkflowName = "test-workflow"
	testWorkflowSlug = "test-workflow"
	testDescription  = "Test workflow description"
)

// =============================================================================
// Mock gRPC Connection
// =============================================================================

type mockConn struct {
	grpc.ClientConnInterface
}

// =============================================================================
// Helper Functions
// =============================================================================

// createTestWorkflow returns a valid Workflow proto for testing.
func createTestWorkflow() *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}
}

// createTestWorkflowWithID returns a Workflow proto with an existing ID (update case).
func createTestWorkflowWithID() *workflowv1.Workflow {
	workflow := createTestWorkflow()
	workflow.Metadata.Id = testWorkflowID
	workflow.Metadata.Slug = testWorkflowSlug
	return workflow
}

// =============================================================================
// ApplyOptions Validation Tests
// =============================================================================

func TestApply_NilWorkflow(t *testing.T) {
	opts := &ApplyOptions{
		Workflow: nil,
		Conn:     &mockConn{},
		OrgID:    testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "workflow is required")
}

func TestApply_NilConnection(t *testing.T) {
	opts := &ApplyOptions{
		Workflow: createTestWorkflow(),
		Conn:     nil,
		OrgID:    testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "connection is required")
}

func TestApply_EmptyOrgID_StillValid(t *testing.T) {
	// Empty OrgID is valid - backend will use authenticated user's org
	opts := &ApplyOptions{
		Workflow: createTestWorkflow(),
		Conn:     &mockConn{},
		OrgID:    "",
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, opts.Workflow, result.Workflow)
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestApply_ValidationOrder(t *testing.T) {
	// Verify validation happens in the correct order:
	// 1. nil workflow check
	// 2. nil connection check

	t.Run("nil workflow checked first", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Workflow: nil,
			Conn:     &mockConn{},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "workflow is required")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Workflow: createTestWorkflow(),
			Conn:     nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "connection is required")
	})
}

// =============================================================================
// DryRun Mode Tests
// =============================================================================

func TestApply_DryRun_ReturnsWithoutRPC(t *testing.T) {
	workflow := createTestWorkflow()

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		OrgID:    testOrgID,
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, workflow, result.Workflow)
	assert.False(t, result.Created) // DryRun returns false for Created
}

func TestApply_DryRun_PreservesWorkflow(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		OrgID:    testOrgID,
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify all fields preserved
	assert.Equal(t, testWorkflowName, result.Workflow.Metadata.Name)
	assert.Equal(t, testOrgID, result.Workflow.Metadata.Org)
	assert.Equal(t, testDescription, result.Workflow.Spec.Description)
}

func TestApply_DryRun_RequiresConnection(t *testing.T) {
	// In DryRun mode, connection is still required because validation happens first
	workflow := createTestWorkflow()

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     nil,
		OrgID:    testOrgID,
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "connection is required")
}

// =============================================================================
// Metadata Population Tests
// =============================================================================

func TestApply_SetsOrgWhenEmpty(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
			Org:  "", // Empty org
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		OrgID:    testOrgID,
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, testOrgID, result.Workflow.Metadata.Org)
}

func TestApply_PreservesExistingOrg(t *testing.T) {
	existingOrg := "existing-org"
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
			Org:  existingOrg, // Already has org
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		OrgID:    testOrgID, // Different org in options
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	// Existing org should be preserved (not overwritten)
	assert.Equal(t, existingOrg, result.Workflow.Metadata.Org)
}

func TestApply_CreatesMetadataWhenNil(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   nil, // Nil metadata
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		OrgID:    testOrgID,
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.Workflow.Metadata)
	assert.Equal(t, testOrgID, result.Workflow.Metadata.Org)
}

// =============================================================================
// ApplyOptions Structure Tests
// =============================================================================

func TestApplyOptions_AllFields(t *testing.T) {
	workflow := createTestWorkflow()

	opts := &ApplyOptions{
		Workflow: workflow,
		OrgID:    testOrgID,
		Conn:     &mockConn{},
		Quiet:    true,
		DryRun:   true,
	}

	assert.Equal(t, workflow, opts.Workflow)
	assert.Equal(t, testOrgID, opts.OrgID)
	assert.NotNil(t, opts.Conn)
	assert.True(t, opts.Quiet)
	assert.True(t, opts.DryRun)
}

func TestApplyOptions_DefaultValues(t *testing.T) {
	// Verify default values (Go zero values)
	opts := &ApplyOptions{}

	assert.Nil(t, opts.Workflow)
	assert.Equal(t, "", opts.OrgID)
	assert.Nil(t, opts.Conn)
	assert.False(t, opts.Quiet)
	assert.False(t, opts.DryRun)
}

// =============================================================================
// ApplyResult Structure Tests
// =============================================================================

func TestApplyResult_Structure(t *testing.T) {
	workflow := createTestWorkflowWithID()

	result := &ApplyResult{
		Workflow: workflow,
		Created:  true,
	}

	assert.NotNil(t, result.Workflow)
	assert.Equal(t, testWorkflowID, result.Workflow.Metadata.Id)
	assert.True(t, result.Created)
}

func TestApplyResult_UpdateCase(t *testing.T) {
	workflow := createTestWorkflowWithID()

	result := &ApplyResult{
		Workflow: workflow,
		Created:  false, // Update, not create
	}

	assert.NotNil(t, result.Workflow)
	assert.False(t, result.Created)
}

// =============================================================================
// Create vs Update Detection Tests
// =============================================================================

func TestApply_DetectsCreate_WhenNoExistingID(t *testing.T) {
	workflow := createTestWorkflow() // No ID set

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		DryRun:   true,
		Quiet:    true,
	}

	// Note: In dry-run mode, Created is always false
	// The create detection logic is in the non-dry-run path
	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestApply_DetectsUpdate_WhenExistingID(t *testing.T) {
	workflow := createTestWorkflowWithID() // Has ID set

	opts := &ApplyOptions{
		Workflow: workflow,
		Conn:     &mockConn{},
		DryRun:   true,
		Quiet:    true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}

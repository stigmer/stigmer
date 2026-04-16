package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

// =============================================================================
// DisplayGetResult Tests - No Panic Verification
// =============================================================================

func TestDisplayGetResult_TableFormat_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(workflow, "table")
	})
}

func TestDisplayGetResult_YAMLFormat_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(workflow, "yaml")
	})
}

func TestDisplayGetResult_JSONFormat_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(workflow, "json")
	})
}

func TestDisplayGetResult_DefaultFormat_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Empty format should default to table
	assert.NotPanics(t, func() {
		DisplayGetResult(workflow, "")
	})
}

func TestDisplayGetResult_UnknownFormat_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testWorkflowID,
			Name: testWorkflowName,
			Slug: testWorkflowSlug,
			Org:  testOrgID,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Unknown format should default to table
	assert.NotPanics(t, func() {
		DisplayGetResult(workflow, "unknown")
	})
}

// =============================================================================
// displayWorkflowSummary Tests - No Panic Verification
// =============================================================================

func TestDisplayWorkflowSummary_NilSpec_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: nil,
	}

	// Should not panic with nil spec
	assert.NotPanics(t, func() {
		displayWorkflowSummary(workflow)
	})
}

func TestDisplayWorkflowSummary_EmptySpec_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{},
	}

	// Should not panic with empty spec
	assert.NotPanics(t, func() {
		displayWorkflowSummary(workflow)
	})
}

func TestDisplayWorkflowSummary_LongDescription_NoPanic(t *testing.T) {
	longDescription := "This is a very long description string that should be truncated when displayed. " +
		"It contains more than 80 characters to test the truncation functionality."

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: longDescription,
		},
	}

	// Should not panic and should truncate
	assert.NotPanics(t, func() {
		displayWorkflowSummary(workflow)
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDisplayWorkflowSummary_AllFields_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "task1"},
				{Name: "task2"},
			},
			Document: &workflowv1.WorkflowDocument{
				Version: "1.0.0",
			},
		},
	}

	// Should not panic with all fields populated
	assert.NotPanics(t, func() {
		displayWorkflowSummary(workflow)
	})
}

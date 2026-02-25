package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

// =============================================================================
// truncateString Tests
// =============================================================================

func TestTruncateString_ShortString(t *testing.T) {
	result := truncateString("hello", 10)
	assert.Equal(t, "hello", result)
}

func TestTruncateString_ExactLength(t *testing.T) {
	result := truncateString("hello", 5)
	assert.Equal(t, "hello", result)
}

func TestTruncateString_LongString(t *testing.T) {
	result := truncateString("hello world", 8)
	assert.Equal(t, "hello...", result)
}

func TestTruncateString_VeryShortMaxLen(t *testing.T) {
	// When maxLen <= 3, just return "..."
	result := truncateString("hello", 3)
	assert.Equal(t, "...", result)

	result = truncateString("hello", 2)
	assert.Equal(t, "...", result)

	result = truncateString("hello", 1)
	assert.Equal(t, "...", result)
}

func TestTruncateString_EmptyString(t *testing.T) {
	result := truncateString("", 10)
	assert.Equal(t, "", result)
}

func TestTruncateString_ZeroMaxLen(t *testing.T) {
	result := truncateString("hello", 0)
	assert.Equal(t, "...", result)
}

func TestTruncateString_ExactTruncationBoundary(t *testing.T) {
	// String of length 6, maxLen of 6 - should not truncate
	result := truncateString("abcdef", 6)
	assert.Equal(t, "abcdef", result)

	// String of length 7, maxLen of 6 - should truncate
	result = truncateString("abcdefg", 6)
	assert.Equal(t, "abc...", result)
}

// =============================================================================
// DisplayApplyResult Tests - No Panic Verification
// =============================================================================

func TestDisplayApplyResult_Created_NoPanic(t *testing.T) {
	result := &ApplyResult{
		Workflow: &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   testWorkflowID,
				Name: testWorkflowName,
				Slug: testWorkflowSlug,
			},
		},
		Created: true,
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayApplyResult(result)
	})
}

func TestDisplayApplyResult_Updated_NoPanic(t *testing.T) {
	result := &ApplyResult{
		Workflow: &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   testWorkflowID,
				Name: testWorkflowName,
				Slug: testWorkflowSlug,
			},
		},
		Created: false,
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayApplyResult(result)
	})
}

// =============================================================================
// DisplayWorkflowPreview Tests - No Panic Verification
// =============================================================================

func TestDisplayWorkflowPreview_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayWorkflowPreview(workflow)
	})
}

func TestDisplayWorkflowPreview_WithTasks_NoPanic(t *testing.T) {
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
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayWorkflowPreview(workflow)
	})
}

func TestDisplayWorkflowPreview_WithDocument_NoPanic(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testWorkflowName,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: testDescription,
			Document: &workflowv1.WorkflowDocument{
				Version: "1.0.0",
			},
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayWorkflowPreview(workflow)
	})
}

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

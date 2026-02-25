package project

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

// =============================================================================
// Test Constants
// =============================================================================

const (
	testOrgID       = "org_01kewqjbtdy0w4d14bnhhy4yc2"
	testProjectID   = "prj_01kewqjbtdy0w4d14bnhhy4yc2"
	testProjectName = "test-project"
	testProjectSlug = "test-project"
	testDescription = "Test project description"
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
// runtimeToString Tests
// =============================================================================

func TestRuntimeToString_Go(t *testing.T) {
	result := runtimeToString(projectv1.ProjectRuntime_go)
	assert.Equal(t, "go", result)
}

func TestRuntimeToString_Python(t *testing.T) {
	result := runtimeToString(projectv1.ProjectRuntime_python)
	assert.Equal(t, "python", result)
}

func TestRuntimeToString_Node(t *testing.T) {
	result := runtimeToString(projectv1.ProjectRuntime_node)
	assert.Equal(t, "node", result)
}

func TestRuntimeToString_Unspecified(t *testing.T) {
	result := runtimeToString(projectv1.ProjectRuntime_project_runtime_unspecified)
	assert.Equal(t, "unknown", result)
}

func TestRuntimeToString_UnknownValue(t *testing.T) {
	// Using an arbitrary large value that doesn't map to any enum
	result := runtimeToString(projectv1.ProjectRuntime(999))
	assert.Equal(t, "unknown", result)
}

// =============================================================================
// getDefaultEntryPoint Tests
// =============================================================================

func TestGetDefaultEntryPoint_Go(t *testing.T) {
	result := getDefaultEntryPoint(projectv1.ProjectRuntime_go)
	assert.Equal(t, "main.go", result)
}

func TestGetDefaultEntryPoint_Python(t *testing.T) {
	result := getDefaultEntryPoint(projectv1.ProjectRuntime_python)
	assert.Equal(t, "main.py", result)
}

func TestGetDefaultEntryPoint_Node(t *testing.T) {
	result := getDefaultEntryPoint(projectv1.ProjectRuntime_node)
	assert.Equal(t, "index.ts", result)
}

func TestGetDefaultEntryPoint_Unspecified(t *testing.T) {
	result := getDefaultEntryPoint(projectv1.ProjectRuntime_project_runtime_unspecified)
	assert.Equal(t, "", result)
}

// =============================================================================
// DisplayProjectInfo Tests - No Panic Verification
// =============================================================================

func TestDisplayProjectInfo_TableFormat_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "table")
	})
}

func TestDisplayProjectInfo_YAMLFormat_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "yaml")
	})
}

func TestDisplayProjectInfo_JSONFormat_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "json")
	})
}

func TestDisplayProjectInfo_DefaultFormat_NoPanic(t *testing.T) {
	project := createTestProject()

	// Empty format should default to table
	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "")
	})
}

func TestDisplayProjectInfo_UnknownFormat_NoPanic(t *testing.T) {
	project := createTestProject()

	// Unknown format should default to table
	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "unknown")
	})
}

// =============================================================================
// DisplayGetResult Tests - No Panic Verification
// =============================================================================

func TestDisplayGetResult_TableFormat_NoPanic(t *testing.T) {
	project := createTestProjectWithID()

	assert.NotPanics(t, func() {
		DisplayGetResult(project, "table")
	})
}

func TestDisplayGetResult_YAMLFormat_NoPanic(t *testing.T) {
	project := createTestProjectWithID()

	assert.NotPanics(t, func() {
		DisplayGetResult(project, "yaml")
	})
}

func TestDisplayGetResult_JSONFormat_NoPanic(t *testing.T) {
	project := createTestProjectWithID()

	assert.NotPanics(t, func() {
		DisplayGetResult(project, "json")
	})
}

// =============================================================================
// DisplayProjectPreview Tests - No Panic Verification
// =============================================================================

func TestDisplayProjectPreview_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		DisplayProjectPreview(project)
	})
}

func TestDisplayProjectPreview_NilSpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: nil,
	}

	assert.NotPanics(t, func() {
		DisplayProjectPreview(project)
	})
}

// =============================================================================
// DisplayValidationSuccess Tests - No Panic Verification
// =============================================================================

func TestDisplayValidationSuccess_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		DisplayValidationSuccess(project, "stigmer.yaml")
	})
}

// =============================================================================
// displayProjectSummary Tests - No Panic Verification
// =============================================================================

func TestDisplayProjectSummary_NilSpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: nil,
	}

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

func TestDisplayProjectSummary_EmptySpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{},
	}

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

func TestDisplayProjectSummary_AllRuntimes_NoPanic(t *testing.T) {
	runtimes := []projectv1.ProjectRuntime{
		projectv1.ProjectRuntime_go,
		projectv1.ProjectRuntime_python,
		projectv1.ProjectRuntime_node,
		projectv1.ProjectRuntime_project_runtime_unspecified,
	}

	for _, runtime := range runtimes {
		project := &projectv1.Project{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Project",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: testProjectName,
			},
			Spec: &projectv1.ProjectSpec{
				Runtime: runtime,
			},
		}

		assert.NotPanics(t, func() {
			displayProjectSummary(project)
		})
	}
}

func TestDisplayProjectSummary_LongDescription_NoPanic(t *testing.T) {
	longDescription := "This is a very long description string that should be truncated when displayed. " +
		"It contains more than 60 characters to test the truncation functionality."

	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:     projectv1.ProjectRuntime_go,
			Description: longDescription,
		},
	}

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

// =============================================================================
// displayResourceCounts Tests - No Panic Verification
// =============================================================================

func TestDisplayResourceCounts_NilSpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: nil,
	}

	assert.NotPanics(t, func() {
		displayResourceCounts(project)
	})
}

func TestDisplayResourceCounts_EmptyResources_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime: projectv1.ProjectRuntime_go,
		},
	}

	assert.NotPanics(t, func() {
		displayResourceCounts(project)
	})
}

func TestDisplayResourceCounts_WithAgents_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime: projectv1.ProjectRuntime_go,
			Agents: []*agentv1.Agent{
				{Metadata: &apiresource.ApiResourceMetadata{Name: "agent1"}},
				{Metadata: &apiresource.ApiResourceMetadata{Name: "agent2"}},
			},
		},
	}

	assert.NotPanics(t, func() {
		displayResourceCounts(project)
	})
}

func TestDisplayResourceCounts_WithWorkflows_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime: projectv1.ProjectRuntime_go,
			Workflows: []*workflowv1.Workflow{
				{Metadata: &apiresource.ApiResourceMetadata{Name: "workflow1"}},
			},
		},
	}

	assert.NotPanics(t, func() {
		displayResourceCounts(project)
	})
}

func TestDisplayResourceCounts_AllResources_NoPanic(t *testing.T) {
	project := createTestProjectWithResources()

	assert.NotPanics(t, func() {
		displayResourceCounts(project)
	})
}

// =============================================================================
// Helper Functions
// =============================================================================

func createTestProject() *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:     projectv1.ProjectRuntime_go,
			EntryPoint:  "main.go",
			Description: testDescription,
		},
	}
}

func createTestProjectWithID() *projectv1.Project {
	project := createTestProject()
	project.Metadata.Id = testProjectID
	project.Metadata.Slug = testProjectSlug
	project.Metadata.Org = testOrgID
	return project
}

func createTestProjectWithResources() *projectv1.Project {
	project := createTestProjectWithID()
	project.Spec.Agents = []*agentv1.Agent{
		{Metadata: &apiresource.ApiResourceMetadata{Name: "agent1"}},
		{Metadata: &apiresource.ApiResourceMetadata{Name: "agent2"}},
	}
	project.Spec.Workflows = []*workflowv1.Workflow{
		{Metadata: &apiresource.ApiResourceMetadata{Name: "workflow1"}},
	}
	return project
}

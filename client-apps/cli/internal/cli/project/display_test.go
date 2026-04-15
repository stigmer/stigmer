package project

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
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

	assert.NotPanics(t, func() {
		DisplayProjectInfo(project, "")
	})
}

func TestDisplayProjectInfo_UnknownFormat_NoPanic(t *testing.T) {
	project := createTestProject()

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
		ApiVersion: "tenancy.stigmer.ai/v1",
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

func TestDisplayValidationSuccess_DeclarativeMode_NoPanic(t *testing.T) {
	project := createDeclarativeTestProject()

	assert.NotPanics(t, func() {
		DisplayValidationSuccess(project, "stigmer.yaml")
	})
}

// =============================================================================
// displayProjectSummary Tests - No Panic Verification
// =============================================================================

func TestDisplayProjectSummary_NilSpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
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
		ApiVersion: "tenancy.stigmer.ai/v1",
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

func TestDisplayProjectSummary_SDKMode_NoPanic(t *testing.T) {
	project := createTestProject()

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

func TestDisplayProjectSummary_DeclarativeMode_NoPanic(t *testing.T) {
	project := createDeclarativeTestProject()

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

func TestDisplayProjectSummary_LongDescription_NoPanic(t *testing.T) {
	longDescription := "This is a very long description string that should be truncated when displayed. " +
		"It contains more than 60 characters to test the truncation functionality."

	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Description: longDescription,
		},
	}

	assert.NotPanics(t, func() {
		displayProjectSummary(project)
	})
}

// =============================================================================
// displayMemberCounts Tests - No Panic Verification
// =============================================================================

func TestDisplayMemberCounts_NilSpec_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: nil,
	}

	assert.NotPanics(t, func() {
		displayMemberCounts(project)
	})
}

func TestDisplayMemberCounts_EmptyMembers_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{},
	}

	assert.NotPanics(t, func() {
		displayMemberCounts(project)
	})
}

func TestDisplayMemberCounts_WithAgents_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Members: []*apiresource.ApiResourceReference{
				{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-1"},
				{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-2"},
			},
		},
	}

	assert.NotPanics(t, func() {
		displayMemberCounts(project)
	})
}

func TestDisplayMemberCounts_WithWorkflows_NoPanic(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			Members: []*apiresource.ApiResourceReference{
				{Org: "test-org", Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "wf-1"},
			},
		},
	}

	assert.NotPanics(t, func() {
		displayMemberCounts(project)
	})
}

func TestDisplayMemberCounts_AllResourceKinds_NoPanic(t *testing.T) {
	project := createTestProjectWithMembers()

	assert.NotPanics(t, func() {
		displayMemberCounts(project)
	})
}

// =============================================================================
// Helper Functions
// =============================================================================

// createTestProject creates an SDK-mode project (with entry_point).
func createTestProject() *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint:  "main.go",
			Description: testDescription,
		},
	}
}

// createDeclarativeTestProject creates a declarative-mode project (no entry_point).
func createDeclarativeTestProject() *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testProjectName,
		},
		Spec: &projectv1.ProjectSpec{
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

func createTestProjectWithMembers() *projectv1.Project {
	project := createTestProjectWithID()
	project.Spec.Members = []*apiresource.ApiResourceReference{
		{Org: testOrgID, Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-1"},
		{Org: testOrgID, Kind: apiresourcekind.ApiResourceKind_agent, Slug: "agent-2"},
		{Org: testOrgID, Kind: apiresourcekind.ApiResourceKind_workflow, Slug: "wf-1"},
		{Org: testOrgID, Kind: apiresourcekind.ApiResourceKind_mcp_server, Slug: "mcp-1"},
	}
	return project
}

package project

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apiresource "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// =============================================================================
// Test Helpers
// =============================================================================

// newProjectWithEntryPoint creates a project with the given name and entry point.
func newProjectWithEntryPoint(name, entryPoint string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
		Spec: &projectv1.ProjectSpec{
			EntryPoint: entryPoint,
		},
	}
}

// newDeclarativeProject creates a project without entry_point (declarative mode).
func newDeclarativeProject(name string) *projectv1.Project {
	return newProjectWithEntryPoint(name, "")
}

// =============================================================================
// Edge Case Tests
// =============================================================================

func TestValidate_NilProject(t *testing.T) {
	err := Validate(nil)
	assert.NoError(t, err, "nil project should pass validation")
}

func TestValidate_NilSpec(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "my-project",
		},
	}
	err := Validate(project)
	assert.NoError(t, err, "nil spec should pass validation")
}

func TestValidate_NilMetadata(t *testing.T) {
	project := &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Spec:       &projectv1.ProjectSpec{},
	}
	err := Validate(project)
	assert.NoError(t, err, "nil metadata should pass validation")
}

func TestValidate_EmptyEntryPoint(t *testing.T) {
	project := newDeclarativeProject("my-project")
	err := Validate(project)
	assert.NoError(t, err, "empty entry_point (declarative mode) should be valid")
}

// =============================================================================
// Entry Point Extension Tests
// =============================================================================

func TestValidate_GoExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "main.go")
	err := Validate(project)
	assert.NoError(t, err, ".go extension should be valid")
}

func TestValidate_PythonExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "main.py")
	err := Validate(project)
	assert.NoError(t, err, ".py extension should be valid")
}

func TestValidate_TypeScriptExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "index.ts")
	err := Validate(project)
	assert.NoError(t, err, ".ts extension should be valid")
}

func TestValidate_JavaScriptExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "index.js")
	err := Validate(project)
	assert.NoError(t, err, ".js extension should be valid")
}

func TestValidate_MjsExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "index.mjs")
	err := Validate(project)
	assert.NoError(t, err, ".mjs extension should be valid")
}

func TestValidate_MtsExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "index.mts")
	err := Validate(project)
	assert.NoError(t, err, ".mts extension should be valid")
}

func TestValidate_UnrecognizedExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "main.rb")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unrecognized extension")
	assert.Contains(t, err.Error(), ".rb")
}

func TestValidate_NoExtension(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "Makefile")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unrecognized extension")
}

func TestValidate_SubdirectoryPath(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "cmd/server/main.go")
	err := Validate(project)
	assert.NoError(t, err, "subdirectory path with valid extension should be valid")
}

func TestValidate_ExtensionCaseInsensitive(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "main.GO")
	err := Validate(project)
	assert.NoError(t, err, "extension comparison should be case-insensitive")
}

// =============================================================================
// Reserved Names Tests
// =============================================================================

func TestValidate_ReservedName_Default(t *testing.T) {
	project := newDeclarativeProject("default")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
	assert.Contains(t, err.Error(), "default")
}

func TestValidate_ReservedName_System(t *testing.T) {
	project := newDeclarativeProject("system")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
	assert.Contains(t, err.Error(), "system")
}

func TestValidate_ReservedName_Admin(t *testing.T) {
	project := newDeclarativeProject("admin")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Root(t *testing.T) {
	project := newDeclarativeProject("root")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Stigmer(t *testing.T) {
	project := newDeclarativeProject("stigmer")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Test(t *testing.T) {
	project := newDeclarativeProject("test")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_CaseInsensitive(t *testing.T) {
	tests := []string{"DEFAULT", "Default", "SYSTEM", "System", "ADMIN", "Admin"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			project := newDeclarativeProject(name)
			err := Validate(project)
			require.Error(t, err, "reserved name check should be case-insensitive")
			assert.Contains(t, err.Error(), "reserved")
		})
	}
}

func TestValidate_ValidProjectName(t *testing.T) {
	validNames := []string{
		"my-project",
		"my-super-app",
		"acme-automation",
		"project123",
		"testing-project", // "testing" is not "test"
		"defaults",        // "defaults" is not "default"
		"systems",         // "systems" is not "system"
	}

	for _, name := range validNames {
		t.Run(name, func(t *testing.T) {
			project := newDeclarativeProject(name)
			err := Validate(project)
			assert.NoError(t, err, "project name %q should be valid", name)
		})
	}
}

// =============================================================================
// Path Security Tests
// =============================================================================

func TestValidate_AbsolutePathRejected(t *testing.T) {
	project := newProjectWithEntryPoint("my-project", "/usr/local/main.go")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "relative path")
}

func TestValidate_DirectoryTraversalRejected(t *testing.T) {
	tests := []struct {
		name      string
		entryPath string
	}{
		{"parent traversal", "../main.go"},
		{"nested parent traversal", "../../main.go"},
		{"mid-path traversal", "src/../main.go"},
		{"complex traversal", "src/../../main.go"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := newProjectWithEntryPoint("my-project", tt.entryPath)
			err := Validate(project)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "directory traversal")
			assert.Contains(t, err.Error(), "..")
		})
	}
}

func TestValidate_ValidRelativePath(t *testing.T) {
	validPaths := []struct {
		name      string
		entryPath string
	}{
		{"simple go file", "main.go"},
		{"subdirectory go", "cmd/main.go"},
		{"deep path go", "cmd/server/main.go"},
		{"python simple", "main.py"},
		{"python src", "src/main.py"},
		{"node ts index", "index.ts"},
		{"node src ts", "src/index.ts"},
		{"current dir", "./main.go"},
	}

	for _, tt := range validPaths {
		t.Run(tt.name, func(t *testing.T) {
			project := newProjectWithEntryPoint("my-project", tt.entryPath)
			err := Validate(project)
			assert.NoError(t, err, "path %q should be valid", tt.entryPath)
		})
	}
}

// =============================================================================
// Error Message Quality Tests
// =============================================================================

func TestValidate_ErrorMessagesIncludeGuidance(t *testing.T) {
	tests := []struct {
		name         string
		project      *projectv1.Project
		wantContains []string
	}{
		{
			name:    "unrecognized extension includes supported list",
			project: newProjectWithEntryPoint("my-project", "main.rb"),
			wantContains: []string{
				"unrecognized extension",
				".rb",
				".go",
				".py",
			},
		},
		{
			name:    "reserved name lists alternatives",
			project: newDeclarativeProject("default"),
			wantContains: []string{
				"reserved",
				"default",
				"Choose a different name",
			},
		},
		{
			name:    "path security provides fix",
			project: newProjectWithEntryPoint("my-project", "../main.go"),
			wantContains: []string{
				"directory traversal",
				"..",
				"relative path",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.project)
			require.Error(t, err)

			errMsg := err.Error()
			for _, want := range tt.wantContains {
				assert.True(t,
					strings.Contains(errMsg, want),
					"error message should contain %q, got: %s", want, errMsg,
				)
			}
		})
	}
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestIsReservedName(t *testing.T) {
	reserved := []string{"default", "system", "admin", "root", "stigmer", "test"}
	for _, name := range reserved {
		assert.True(t, isReservedName(name), "%q should be reserved", name)
		assert.True(t, isReservedName(strings.ToUpper(name)), "%q should be reserved (uppercase)", name)
	}

	notReserved := []string{"my-project", "defaults", "systems", "administrator"}
	for _, name := range notReserved {
		assert.False(t, isReservedName(name), "%q should not be reserved", name)
	}
}

func TestContainsDirectoryTraversal(t *testing.T) {
	withTraversal := []string{"../file", "../../file", "dir/../file", "a/b/../c/d"}
	for _, path := range withTraversal {
		assert.True(t, containsDirectoryTraversal(path), "%q should contain traversal", path)
	}

	withoutTraversal := []string{"file", "dir/file", "./file", "a/b/c/d", "..file", "file.."}
	for _, path := range withoutTraversal {
		assert.False(t, containsDirectoryTraversal(path), "%q should not contain traversal", path)
	}
}

// =============================================================================
// Comprehensive Validation Flow Tests
// =============================================================================

func TestValidate_AllValidationsPass(t *testing.T) {
	project := newProjectWithEntryPoint("my-super-app", "cmd/main.go")
	err := Validate(project)
	assert.NoError(t, err, "fully valid project should pass all validations")
}

func TestValidate_DeclarativeMode_AllValidationsPass(t *testing.T) {
	project := newDeclarativeProject("my-super-app")
	err := Validate(project)
	assert.NoError(t, err, "declarative project should pass all validations")
}

func TestValidate_MultipleIssues_ReportsFirst(t *testing.T) {
	// Project with both reserved name and unrecognized extension
	// Should report the first validation error (entry point extension)
	project := newProjectWithEntryPoint("default", "main.rb")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unrecognized extension")
}

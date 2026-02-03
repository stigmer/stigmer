package project

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// =============================================================================
// Test Helpers
// =============================================================================

// newProject creates a valid project with the given name, runtime, and entry point.
func newProject(name string, runtime projectv1.ProjectRuntime, entryPoint string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:    runtime,
			EntryPoint: entryPoint,
		},
	}
}

// newMinimalProject creates a project with just name and runtime.
func newMinimalProject(name string, runtime projectv1.ProjectRuntime) *projectv1.Project {
	return newProject(name, runtime, "")
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
		ApiVersion: "agentic.stigmer.ai/v1",
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
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Spec: &projectv1.ProjectSpec{
			Runtime: projectv1.ProjectRuntime_go,
		},
	}
	err := Validate(project)
	assert.NoError(t, err, "nil metadata should pass validation")
}

func TestValidate_EmptyEntryPoint(t *testing.T) {
	tests := []struct {
		name    string
		runtime projectv1.ProjectRuntime
	}{
		{"go runtime", projectv1.ProjectRuntime_go},
		{"python runtime", projectv1.ProjectRuntime_python},
		{"node runtime", projectv1.ProjectRuntime_node},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := newMinimalProject("my-project", tt.runtime)
			err := Validate(project)
			assert.NoError(t, err, "empty entry_point should be valid for %s", tt.name)
		})
	}
}

// =============================================================================
// Runtime-EntryPoint Consistency Tests
// =============================================================================

func TestValidate_GoWithGoExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_go, "main.go")
	err := Validate(project)
	assert.NoError(t, err, "go runtime with .go extension should be valid")
}

func TestValidate_GoWithPyExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_go, "main.py")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid extension")
	assert.Contains(t, err.Error(), "go runtime")
	assert.Contains(t, err.Error(), ".go")
}

func TestValidate_PythonWithPyExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_python, "main.py")
	err := Validate(project)
	assert.NoError(t, err, "python runtime with .py extension should be valid")
}

func TestValidate_PythonWithGoExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_python, "main.go")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid extension")
	assert.Contains(t, err.Error(), "python runtime")
	assert.Contains(t, err.Error(), ".py")
}

func TestValidate_NodeWithJsExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_node, "index.js")
	err := Validate(project)
	assert.NoError(t, err, "node runtime with .js extension should be valid")
}

func TestValidate_NodeWithTsExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_node, "index.ts")
	err := Validate(project)
	assert.NoError(t, err, "node runtime with .ts extension should be valid")
}

func TestValidate_NodeWithMjsExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_node, "index.mjs")
	err := Validate(project)
	assert.NoError(t, err, "node runtime with .mjs extension should be valid")
}

func TestValidate_NodeWithMtsExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_node, "index.mts")
	err := Validate(project)
	assert.NoError(t, err, "node runtime with .mts extension should be valid")
}

func TestValidate_NodeWithGoExtension(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_node, "main.go")
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid extension")
	assert.Contains(t, err.Error(), "node runtime")
	assert.Contains(t, err.Error(), ".js")
	assert.Contains(t, err.Error(), ".ts")
}

func TestValidate_GoWithSubdirectoryPath(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_go, "cmd/server/main.go")
	err := Validate(project)
	assert.NoError(t, err, "go runtime with subdirectory path should be valid")
}

func TestValidate_PythonWithSubdirectoryPath(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_python, "src/main.py")
	err := Validate(project)
	assert.NoError(t, err, "python runtime with subdirectory path should be valid")
}

func TestValidate_ExtensionCaseInsensitive(t *testing.T) {
	// Note: While we compare lowercase, the actual extension from filepath.Ext
	// preserves case, so .GO would technically fail. This test documents behavior.
	project := newProject("my-project", projectv1.ProjectRuntime_go, "main.GO")
	err := Validate(project)
	// filepath.Ext returns ".GO", our code lowercases it to ".go"
	assert.NoError(t, err, "extension comparison should be case-insensitive")
}

// =============================================================================
// Reserved Names Tests
// =============================================================================

func TestValidate_ReservedName_Default(t *testing.T) {
	project := newMinimalProject("default", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
	assert.Contains(t, err.Error(), "default")
}

func TestValidate_ReservedName_System(t *testing.T) {
	project := newMinimalProject("system", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
	assert.Contains(t, err.Error(), "system")
}

func TestValidate_ReservedName_Admin(t *testing.T) {
	project := newMinimalProject("admin", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Root(t *testing.T) {
	project := newMinimalProject("root", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Stigmer(t *testing.T) {
	project := newMinimalProject("stigmer", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_Test(t *testing.T) {
	project := newMinimalProject("test", projectv1.ProjectRuntime_go)
	err := Validate(project)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reserved")
}

func TestValidate_ReservedName_CaseInsensitive(t *testing.T) {
	tests := []string{"DEFAULT", "Default", "SYSTEM", "System", "ADMIN", "Admin"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			project := newMinimalProject(name, projectv1.ProjectRuntime_go)
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
			project := newMinimalProject(name, projectv1.ProjectRuntime_go)
			err := Validate(project)
			assert.NoError(t, err, "project name %q should be valid", name)
		})
	}
}

// =============================================================================
// Path Security Tests
// =============================================================================

func TestValidate_AbsolutePathRejected(t *testing.T) {
	project := newProject("my-project", projectv1.ProjectRuntime_go, "/usr/local/main.go")
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
			project := newProject("my-project", projectv1.ProjectRuntime_go, tt.entryPath)
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
		runtime   projectv1.ProjectRuntime
		entryPath string
	}{
		{"simple file", projectv1.ProjectRuntime_go, "main.go"},
		{"subdirectory", projectv1.ProjectRuntime_go, "cmd/main.go"},
		{"deep path", projectv1.ProjectRuntime_go, "cmd/server/main.go"},
		{"python simple", projectv1.ProjectRuntime_python, "main.py"},
		{"python src", projectv1.ProjectRuntime_python, "src/main.py"},
		{"node index", projectv1.ProjectRuntime_node, "index.ts"},
		{"node src", projectv1.ProjectRuntime_node, "src/index.ts"},
		{"current dir", projectv1.ProjectRuntime_go, "./main.go"},
	}

	for _, tt := range validPaths {
		t.Run(tt.name, func(t *testing.T) {
			project := newProject("my-project", tt.runtime, tt.entryPath)
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
			name:    "runtime mismatch includes fix guidance",
			project: newProject("my-project", projectv1.ProjectRuntime_go, "main.py"),
			wantContains: []string{
				"invalid extension",
				"go runtime",
				".go",
				"change the entry_point",
			},
		},
		{
			name:    "reserved name lists alternatives",
			project: newMinimalProject("default", projectv1.ProjectRuntime_go),
			wantContains: []string{
				"reserved",
				"default",
				"Choose a different name",
			},
		},
		{
			name:    "path security provides fix",
			project: newProject("my-project", projectv1.ProjectRuntime_go, "../main.go"),
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

func TestGetValidExtensions(t *testing.T) {
	tests := []struct {
		runtime  projectv1.ProjectRuntime
		expected []string
	}{
		{projectv1.ProjectRuntime_go, []string{".go"}},
		{projectv1.ProjectRuntime_python, []string{".py"}},
		{projectv1.ProjectRuntime_node, []string{".js", ".ts", ".mjs", ".mts"}},
		{projectv1.ProjectRuntime_project_runtime_unspecified, nil},
	}

	for _, tt := range tests {
		t.Run(tt.runtime.String(), func(t *testing.T) {
			result := getValidExtensions(tt.runtime)
			assert.Equal(t, tt.expected, result)
		})
	}
}

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
	project := newProject("my-super-app", projectv1.ProjectRuntime_go, "cmd/main.go")
	err := Validate(project)
	assert.NoError(t, err, "fully valid project should pass all validations")
}

func TestValidate_MultipleIssues_ReportsFirst(t *testing.T) {
	// Project with both reserved name and wrong extension
	// Should report the first validation error (runtime-entrypoint)
	project := newProject("default", projectv1.ProjectRuntime_go, "main.py")
	err := Validate(project)
	require.Error(t, err)
	// First validation is runtime-entrypoint
	assert.Contains(t, err.Error(), "invalid extension")
}

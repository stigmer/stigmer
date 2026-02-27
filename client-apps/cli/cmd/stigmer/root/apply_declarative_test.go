package root

import (
	"os"
	"path/filepath"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// scanResourceFiles
// =============================================================================

func TestScanResourceFiles_FindsYAMLFiles(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")
	writeResourceYAML(t, dir, "workflow.yml", "Workflow", "my-workflow")

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 2)
}

func TestScanResourceFiles_ExcludesStigmerYAML(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "stigmer.yaml", "Project", "my-project")
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 1)
	assert.Contains(t, files[0], "agent.yaml")
}

func TestScanResourceFiles_ExcludesStigmerYAML_CaseInsensitive(t *testing.T) {
	dir := t.TempDir()
	// The production code compares strings.ToLower(name) == "stigmer.yaml"
	// so any casing variant should be excluded.
	writeResourceYAML(t, dir, "STIGMER.YAML", "Project", "proj")
	writeResourceYAML(t, dir, "Stigmer.Yaml", "Project", "proj2")
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "agent")

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 1)
}

func TestScanResourceFiles_SkipsNonYAMLFiles(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Hello"), 0644)
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("notes"), 0644)
	os.WriteFile(filepath.Join(dir, "config.json"), []byte("{}"), 0644)

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 1)
}

func TestScanResourceFiles_SkipsSubdirectories(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	subDir := filepath.Join(dir, "nested")
	require.NoError(t, os.MkdirAll(subDir, 0755))
	writeResourceYAML(t, subDir, "hidden-agent.yaml", "Agent", "hidden")

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 1, "subdirectories should not be traversed")
}

func TestScanResourceFiles_EmptyDirectory(t *testing.T) {
	dir := t.TempDir()

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	assert.Empty(t, files)
}

func TestScanResourceFiles_NonExistentDirectory(t *testing.T) {
	_, err := scanResourceFiles("/nonexistent/path")
	assert.Error(t, err)
}

func TestScanResourceFiles_ReturnsAbsolutePaths(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	files, err := scanResourceFiles(dir)
	require.NoError(t, err)
	require.Len(t, files, 1)
	assert.True(t, filepath.IsAbs(files[0]))
	assert.Equal(t, filepath.Join(dir, "agent.yaml"), files[0])
}

// =============================================================================
// detectResourceItems
// =============================================================================

func TestDetectResourceItems_ValidAgentFile(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	items, err := detectResourceItems([]string{path})
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "Agent", items[0].kind)
}

func TestDetectResourceItems_MultipleFiles(t *testing.T) {
	dir := t.TempDir()
	p1 := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")
	p2 := writeResourceYAML(t, dir, "workflow.yaml", "Workflow", "my-wf")

	items, err := detectResourceItems([]string{p1, p2})
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestDetectResourceItems_SkipsProjectKind(t *testing.T) {
	dir := t.TempDir()
	p1 := writeResourceYAML(t, dir, "project.yaml", "Project", "my-project")
	p2 := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	items, err := detectResourceItems([]string{p1, p2})
	require.NoError(t, err)
	assert.Len(t, items, 1, "Project kind should be silently skipped")
	assert.Equal(t, "Agent", items[0].kind)
}

func TestDetectResourceItems_UnknownKindError(t *testing.T) {
	dir := t.TempDir()
	content := `apiVersion: agentic.stigmer.ai/v1
kind: FictionalResource
metadata:
  name: test
`
	path := filepath.Join(dir, "unknown.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	_, err := detectResourceItems([]string{path})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "FictionalResource")
}

func TestDetectResourceItems_EmptyFileList(t *testing.T) {
	items, err := detectResourceItems(nil)
	require.NoError(t, err)
	assert.Empty(t, items)
}

func TestDetectResourceItems_PreservesRawContent(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	items, err := detectResourceItems([]string{path})
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.NotEmpty(t, items[0].rawContent)
}

// =============================================================================
// countMembersByKind
// =============================================================================

func TestCountMembersByKind_NilSlice(t *testing.T) {
	counts := countMembersByKind(nil)
	assert.Empty(t, counts)
}

func TestCountMembersByKind_EmptySlice(t *testing.T) {
	counts := countMembersByKind([]*apiresource.ApiResourceReference{})
	assert.Empty(t, counts)
}

func TestCountMembersByKind_SingleKind(t *testing.T) {
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_agent,
	)
	counts := countMembersByKind(members)
	assert.Equal(t, 2, counts[apiresourcekind.ApiResourceKind_agent])
	assert.Len(t, counts, 1)
}

func TestCountMembersByKind_MultipleKinds(t *testing.T) {
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_mcp_server,
	)
	counts := countMembersByKind(members)
	assert.Equal(t, 2, counts[apiresourcekind.ApiResourceKind_agent])
	assert.Equal(t, 1, counts[apiresourcekind.ApiResourceKind_workflow])
	assert.Equal(t, 1, counts[apiresourcekind.ApiResourceKind_mcp_server])
}

func TestCountMembersByKind_AllSupportedKinds(t *testing.T) {
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
		apiresourcekind.ApiResourceKind_skill,
	)
	counts := countMembersByKind(members)
	assert.Len(t, counts, 4)
}

// =============================================================================
// buildDeclarativeResult
// =============================================================================

func TestBuildDeclarativeResult_Created(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
	)
	cr := buildDeclarativeResult(result, members)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	assert.Contains(t, cr.Message, testApplyProjectName)
	requireSectionField(t, cr, "Project", "Name", testApplyProjectName)
	requireSectionField(t, cr, "Project", "Slug", testApplyProjectSlug)
}

func TestBuildDeclarativeResult_Updated(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, false)
	members := newTestMembers(apiresourcekind.ApiResourceKind_agent)
	cr := buildDeclarativeResult(result, members)

	assert.Contains(t, cr.Message, "updated")
}

func TestBuildDeclarativeResult_MemberCounts(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
	)
	cr := buildDeclarativeResult(result, members)

	requireSectionField(t, cr, "Members Applied", "agent", "2")
	requireSectionField(t, cr, "Members Applied", "workflow", "1")
	requireSectionField(t, cr, "Members Applied", "mcp_server", "1")
}

func TestBuildDeclarativeResult_WithReconciliation(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, false)
	result.Project.Status = &projectv1.ProjectStatus{
		LastReconciliation: &projectv1.ReconciliationSummary{
			Created: newTestMembers(apiresourcekind.ApiResourceKind_agent, apiresourcekind.ApiResourceKind_agent),
			Updated: newTestMembers(apiresourcekind.ApiResourceKind_workflow),
			Deleted: newTestMembers(apiresourcekind.ApiResourceKind_mcp_server),
		},
	}
	members := newTestMembers(apiresourcekind.ApiResourceKind_agent)

	cr := buildDeclarativeResult(result, members)

	requireSectionField(t, cr, "Reconciliation", "Created", "2")
	requireSectionField(t, cr, "Reconciliation", "Updated", "1")
	requireSectionField(t, cr, "Reconciliation", "Pruned", "1")
}

func TestBuildDeclarativeResult_EmptyMembers(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildDeclarativeResult(result, nil)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.True(t, len(cr.Hints) > 0, "should have hints")
}

func TestBuildDeclarativeResult_ProjectIDPresent(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildDeclarativeResult(result, nil)

	requireSectionField(t, cr, "Project", "ID", testApplyProjectID)
}

// =============================================================================
// buildNoResourcesResult
// =============================================================================

func TestBuildNoResourcesResult_ContainsDirectory(t *testing.T) {
	cr := buildNoResourcesResult("/home/user/my-project")

	assert.Equal(t, clioutput.StatusWarning, cr.Status)
	assert.Contains(t, cr.Message, "No resource files")
	found := findSectionField(cr, "", "Directory")
	assert.Contains(t, found, "/home/user/my-project")
}

func TestBuildNoResourcesResult_HasHint(t *testing.T) {
	cr := buildNoResourcesResult("/tmp/test")
	assert.True(t, len(cr.Hints) > 0)
}

// =============================================================================
// buildDryRunSummary
// =============================================================================

func TestBuildDryRunSummary_ContainsCount(t *testing.T) {
	cr := buildDryRunSummary(5)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "5")
	assert.Contains(t, cr.Message, "validated")
}

func TestBuildDryRunSummary_HasHint(t *testing.T) {
	cr := buildDryRunSummary(1)
	assert.True(t, len(cr.Hints) > 0)
	assert.Contains(t, cr.Hints[0], "dry-run")
}
